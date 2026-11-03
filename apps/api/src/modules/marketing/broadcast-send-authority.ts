/**
 * 排程送出前重新檢查發送權限（change require-broadcast-send-permissions，issue #409 MKT-02、MKT-03）。
 *
 * 排程器與 coupon-broadcast 佇列 job 沒有 request：送出前，以「排定送出的成員」（scheduledById，舊資料為建立者）
 * 當下的有效權限檢查。成員不存在、已停用，或少了需要的權限時不送出，群發標為失敗並寫原因，後台列表看得到。
 * 佇列 job 也檢查（PR #438 審查）：job 重試或 outbox 延後送出時，成員可能已經被降權。
 *
 * 查詢收 TenantCtx（AGENTS.md 結構規則 2）；rejectUnauthorizedScheduledSend 是入口用的函式，
 * 在交易外計算有效權限（Redis 快取）。
 */
import type { PrismaClient } from '@prisma/client';
import { COUPON_ISSUED_VIA, PERMISSION_BY_CODE } from '@open333crm/shared';
import { logger } from '@open333crm/core';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import { getEffectiveTenantPermissions } from '../../services/permission.service.js';
import { getTenantPlanId } from '../../services/tenant-plan.cache.js';

/** 判斷需要哪些權限所需的群發欄位 */
export interface SendAuthorityBroadcast {
  couponId: string | null;
  couponIssuedVia: string | null;
}

/**
 * 送出一則群發需要的權限（design D4）：
 * - 一般群發：marketing.broadcast
 * - 群發頁的附券群發：marketing.broadcast、coupon.issue
 * - 券詳情批次發券：只要 coupon.issue（add-coupon-system design D31）
 */
export function requiredSendPermissions(broadcast: SendAuthorityBroadcast): string[] {
  if (!broadcast.couponId) return ['marketing.broadcast'];
  if (broadcast.couponIssuedVia === COUPON_ISSUED_VIA.BATCH) return ['coupon.issue'];
  return ['marketing.broadcast', 'coupon.issue'];
}

/** 排定送出的成員：scheduledById，舊資料（null）退回建立者 */
export function schedulingMemberId(broadcast: { scheduledById: string | null; createdById: string }): string {
  return broadcast.scheduledById ?? broadcast.createdById;
}

export interface SchedulingMember {
  name: string;
  isActive: boolean;
  roleId: string | null;
}

/** 讀排定送出的成員（同租戶）；查不到（已永久刪除）回 null */
export async function findSchedulingMember(ctx: TenantCtx, agentId: string): Promise<SchedulingMember | null> {
  return ctx.tx.agent.findFirst({
    where: { id: agentId, tenantId: ctx.tenantId },
    select: { name: true, isActive: true, roleId: true },
  });
}

export interface SendDenial {
  code: 'SCHEDULED_SENDER_NOT_FOUND' | 'SCHEDULED_SENDER_INACTIVE' | 'SCHEDULED_SENDER_FORBIDDEN';
  reason: string;
  /** 缺少的權限碼（只有 SCHEDULED_SENDER_FORBIDDEN 有），記 log 用 */
  missingPermission?: string;
}

const RESEND_HINT = '請由有權限的成員確認內容後重新發送';

/**
 * 依成員與他當下的有效權限判斷可不可以送出；可以時回 null。
 * 失敗原因寫中文權限名稱與成員名稱，不寫權限碼（design D5）。
 */
export function scheduledSendDenial(
  member: SchedulingMember | null,
  effectivePermissions: ReadonlySet<string>,
  required: readonly string[],
): SendDenial | null {
  if (!member) {
    return { code: 'SCHEDULED_SENDER_NOT_FOUND', reason: `排定這則群發的成員已不存在，沒有發送。${RESEND_HINT}` };
  }
  if (!member.isActive) {
    return { code: 'SCHEDULED_SENDER_INACTIVE', reason: `排定這則群發的成員「${member.name}」已停用，沒有發送。${RESEND_HINT}` };
  }
  const missing = required.find((code) => !effectivePermissions.has(code));
  if (missing) {
    const label = PERMISSION_BY_CODE.get(missing)?.label ?? missing;
    return {
      code: 'SCHEDULED_SENDER_FORBIDDEN',
      reason: `排定這則群發的成員「${member.name}」已沒有「${label}」權限，沒有發送。${RESEND_HINT}`,
      missingPermission: missing,
    };
  }
  return null;
}

/**
 * 把排程群發標為失敗（不送出）。條件更新只動仍是 scheduled 的群發：同時執行的佇列 job 已搶占（sending）時不覆寫。
 * 回傳是否有更新。
 */
export async function markScheduledSendDenied(ctx: TenantCtx, broadcastId: string, denial: SendDenial): Promise<boolean> {
  const updated = await ctx.tx.broadcast.updateMany({
    where: { id: broadcastId, tenantId: ctx.tenantId, status: 'scheduled' },
    data: { status: 'failed', failureCode: denial.code, failureReason: denial.reason },
  });
  return updated.count > 0;
}

/** 檢查權限用到的群發欄位 */
export interface SendAuthorityTarget extends SendAuthorityBroadcast {
  id: string;
  tenantId: string;
  createdById: string;
  scheduledById: string | null;
}

export interface SendAuthorityDeps {
  /** app_tenant 的基底連線（inTenant 用） */
  prisma: PrismaClient;
  /** 計算有效權限（角色 ∩ 方案天花板）的連線，與 requirePermission 相同用 prismaAdmin */
  adminPrisma: PrismaClient;
}

/** 讀檢查權限用到的群發欄位；查不到回 null */
export async function findSendAuthorityTarget(ctx: TenantCtx, broadcastId: string): Promise<SendAuthorityTarget | null> {
  return ctx.tx.broadcast.findFirst({
    where: { id: broadcastId, tenantId: ctx.tenantId },
    select: { id: true, tenantId: true, createdById: true, scheduledById: true, couponId: true, couponIssuedVia: true },
  });
}

/**
 * 排定送出的成員當下不能送這則群發時，把群發標為失敗並回傳原因；可以送時回 null。
 * 給群發 ID 時先讀群發（查不到回 null，交給發送流程處理）。
 * 檢查與發送的搶占不在同一個交易：兩者之間的毫秒內被降權時仍會送出，與 HTTP 請求通過權限後立即送出相同。
 */
export async function rejectUnauthorizedScheduledSend(
  deps: SendAuthorityDeps,
  tenantId: string,
  target: string | SendAuthorityTarget,
): Promise<SendDenial | null> {
  const broadcast = typeof target === 'string'
    ? await inTenant(deps.prisma, tenantId, (ctx) => findSendAuthorityTarget(ctx, target))
    : target;
  if (!broadcast) return null;
  const member = await inTenant(deps.prisma, tenantId, (ctx) => findSchedulingMember(ctx, schedulingMemberId(broadcast)));
  const effective = member?.isActive
    ? await getEffectiveTenantPermissions(deps.adminPrisma, member.roleId, await getTenantPlanId(deps.adminPrisma, tenantId))
    : new Set<string>();
  const denial = scheduledSendDenial(member, effective, requiredSendPermissions(broadcast));
  if (!denial) return null;
  const marked = await inTenant(deps.prisma, tenantId, (ctx) => markScheduledSendDenied(ctx, broadcast.id, denial));
  logger.warn('[Broadcast] 排定的成員沒有發送權限，廣播沒有發送', {
    tenantId, broadcastId: broadcast.id, code: denial.code, missingPermission: denial.missingPermission, marked,
  });
  return denial;
}
