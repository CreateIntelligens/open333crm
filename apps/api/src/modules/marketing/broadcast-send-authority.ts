/**
 * 排程送出前重新檢查發送權限（change require-broadcast-send-permissions，issue #409 MKT-02、MKT-03）。
 *
 * 排程器沒有 request：到期送出前，以「排定送出的成員」（scheduledById，舊資料為建立者）當下的有效權限檢查。
 * 成員不存在、已停用，或少了需要的權限時不送出，群發標為失敗並寫原因，後台列表看得到。
 *
 * 這裡的查詢收 TenantCtx（AGENTS.md 結構規則 2）；有效權限的計算（Redis 快取）由排程器在交易外呼叫。
 */
import { COUPON_ISSUED_VIA, PERMISSION_BY_CODE } from '@open333crm/shared';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

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
