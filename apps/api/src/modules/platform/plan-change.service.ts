/**
 * 方案升級/加購申請（租戶發起 → 平台審核核准）。
 * - upgrade：核准後改 tenant.planId + 失效權限快取
 * - token_topup：核准後加購量只計入核准當月（台灣時間）的 AI 月額度，下個月回到方案額度。
 *   不寫 limitOverrides；當月加購量由 plan-limits.service 的 getEffectiveLimit() 從已核准的申請算出。
 */
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';
import { invalidateTenantPlan } from '../../services/tenant-plan.cache.js';
import { clearQuotaAlertFlags, clearTokenQuotaCache } from '../trial/token-quota.service.js';
import { TRIAL_EXIT_DATA, assertNotTrialPlan } from './trial-admin.service.js';
import {
  getEffectiveLimit,
  monthlyTokensRaisedByPlanChange,
  resolveEffectiveLimit,
  sumMonthlyTopupTokens,
} from './plan-limits.service.js';

// ── 租戶側 ──

/** 租戶發起申請。已有 pending 申請時擋（一次一筆）。 */
export async function createPlanChangeRequest(
  prisma: PrismaClient,
  tenantId: string,
  input: { type: 'upgrade' | 'token_topup'; targetPlanSlug?: string; topupTokens?: number; note?: string },
) {
  const pending = await prisma.planChangeRequest.findFirst({
    where: { tenantId, status: 'pending' },
    select: { id: true },
  });
  if (pending) throw new AppError('已有處理中的申請，請等待審核', 'CONFLICT', 409);

  if (input.type === 'upgrade') {
    if (!input.targetPlanSlug) throw new AppError('缺少目標方案', 'BAD_REQUEST', 400);
    const plan = await prisma.plan.findUnique({ where: { slug: input.targetPlanSlug }, select: { id: true } });
    if (!plan) throw new AppError('目標方案不存在', 'NOT_FOUND', 404);
    await assertNotTrialPlan(prisma, input.targetPlanSlug);
  } else {
    if (!input.topupTokens || input.topupTokens <= 0) throw new AppError('加購 token 數需為正整數', 'BAD_REQUEST', 400);
  }

  return prisma.planChangeRequest.create({
    data: {
      tenantId,
      type: input.type,
      targetPlanSlug: input.targetPlanSlug,
      topupTokens: input.topupTokens,
      note: input.note,
    },
  });
}

export interface PlanChangeNotifyContext {
  tenantName: string;
  /** 升級申請的目標方案名稱；方案已不存在時退回 slug，加購申請是 null */
  targetPlanName: string | null;
  /** 啟用中的平台帳號 */
  recipients: Array<{ id: string; email: string; name: string }>;
}

/**
 * 通知平台帳號需要的資料：租戶名稱、目標方案名稱與啟用中的平台帳號（change add-plan-change-platform-notify）。
 * platform_users 是平台層資料表，呼叫端要傳 app_admin 連線。
 */
export async function getPlanChangeNotifyContext(
  prisma: PrismaClient,
  request: { tenantId: string; type: string; targetPlanSlug: string | null },
): Promise<PlanChangeNotifyContext> {
  const [tenant, plan, recipients] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: request.tenantId }, select: { name: true } }),
    request.type === 'upgrade' && request.targetPlanSlug
      ? prisma.plan.findUnique({ where: { slug: request.targetPlanSlug }, select: { name: true } })
      : Promise.resolve(null),
    prisma.platformUser.findMany({
      where: { isActive: true },
      select: { id: true, email: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    tenantName: tenant?.name ?? request.tenantId,
    targetPlanName: request.type === 'upgrade' ? plan?.name ?? request.targetPlanSlug : null,
    recipients,
  };
}

/** 租戶查自己的申請。 */
export async function listTenantPlanChangeRequests(prisma: PrismaClient, tenantId: string) {
  return prisma.planChangeRequest.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

// ── 平台側 ──

/**
 * 平台列待審申請（含租戶名/方案），並附租戶本月（台灣時間）已核准的加購量與目前本月的 AI 月額度上限，
 * 供審核者判斷。待審申請很少，逐筆查詢。
 */
export async function listPendingRequests(prisma: PrismaClient) {
  const rows = await prisma.planChangeRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: { tenant: { select: { name: true, plan: { select: { slug: true, name: true } } } } },
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantName: r.tenant.name,
      currentPlan: r.tenant.plan?.name ?? null,
      type: r.type,
      targetPlanSlug: r.targetPlanSlug,
      topupTokens: r.topupTokens,
      note: r.note,
      createdAt: r.createdAt,
      monthlyTopupTokens: await sumMonthlyTopupTokens(prisma, r.tenantId),
      monthlyTokenLimit: await getEffectiveLimit(prisma, r.tenantId, 'monthlyTokens'),
    })),
  );
}

/**
 * 核准申請：upgrade 改方案、token_topup 把加購量計入核准當月的月額度。
 * 試用租戶核准 upgrade 即轉正式、脫離試用；回傳的 trialExited 供稽核記錄。
 */
export async function approveRequest(
  prisma: PrismaClient,
  redis: Redis,
  requestId: string,
  platformUserId: string,
  reviewNote?: string,
) {
  const req = await prisma.planChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError('申請不存在', 'NOT_FOUND', 404);
  if (req.status !== 'pending') throw new AppError('此申請已處理', 'BAD_REQUEST', 400);
  const review = { status: 'approved', reviewedBy: platformUserId, reviewedAt: new Date(), reviewNote };

  if (req.type !== 'upgrade') {
    await approveTopup(prisma, redis, req, review);
    const approved = await prisma.planChangeRequest.findUnique({ where: { id: requestId } });
    return { ...approved!, trialExited: false };
  }

  const plan = await prisma.plan.findUnique({ where: { slug: req.targetPlanSlug! }, select: { id: true, limits: true } });
  if (!plan) throw new AppError('目標方案不存在', 'NOT_FOUND', 404);
  await assertNotTrialPlan(prisma, req.targetPlanSlug!);
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenantId },
    select: { trialEndsAt: true, limitOverrides: true, plan: { select: { limits: true } } },
  });
  const trialExited = tenant?.trialEndsAt != null;
  await prisma.tenant.update({
    where: { id: req.tenantId },
    data: trialExited ? { planId: plan.id, ...TRIAL_EXIT_DATA } : { planId: plan.id },
  });
  // 方案變動 → 失效權限天花板快取 + 租戶 plan 快取
  await invalidatePlanPermissions(redis, plan.id);
  invalidateTenantPlan(req.tenantId);
  // 新方案的 AI 月額度較高時清掉本月的告警旗標，用量跨越新上限的門檻才會再通知（AUDIT PLAN-13）
  if (tenant && monthlyTokensRaisedByPlanChange(tenant, plan)) await clearQuotaAlertFlags(redis, req.tenantId);

  const approved = await prisma.planChangeRequest.update({ where: { id: requestId }, data: review });
  return { ...approved, trialExited };
}

/**
 * 核准加購：只把申請改成 approved，不改租戶。加購量由 getEffectiveLimit() 從本月已核准的申請算出，
 * 只計入核准當月（台灣時間），下個月回到方案額度（AUDIT PLAN-02、PLAN-05）。
 */
async function approveTopup(
  prisma: PrismaClient,
  redis: Redis,
  req: { id: string; tenantId: string },
  review: { status: string; reviewedBy: string; reviewedAt: Date; reviewNote?: string },
) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenantId },
    select: { limitOverrides: true, plan: { select: { limits: true } } },
  });
  // 基礎上限無上限時加購無意義：擋核准並提示，避免管理員誤以為加購已生效
  if (!tenant || resolveEffectiveLimit(tenant, 'monthlyTokens') === null) {
    throw new AppError('此租戶方案 AI 額度已為無上限，無需加購', 'TOPUP_UNLIMITED', 400);
  }
  // 條件更新：同一筆申請同時核准兩次，只有一次成功
  const claimed = await prisma.planChangeRequest.updateMany({ where: { id: req.id, status: 'pending' }, data: review });
  if (claimed.count === 0) throw new AppError('此申請已處理', 'BAD_REQUEST', 400);
  // 新上限由月額度檢查直接從資料庫讀。刪除計數器是讓系統從 AiUsage 補建，校正少算的用量（AUDIT USAGE-03）
  await clearTokenQuotaCache(redis, req.tenantId);
  // 本月的告警旗標還在的話，用量跨越新上限的 80%／100% 時不會再通知（AUDIT PLAN-06）
  await clearQuotaAlertFlags(redis, req.tenantId);
}

/** 駁回申請。 */
export async function rejectRequest(
  prisma: PrismaClient,
  requestId: string,
  platformUserId: string,
  reviewNote?: string,
) {
  const req = await prisma.planChangeRequest.findUnique({ where: { id: requestId }, select: { status: true } });
  if (!req) throw new AppError('申請不存在', 'NOT_FOUND', 404);
  if (req.status !== 'pending') throw new AppError('此申請已處理', 'BAD_REQUEST', 400);
  return prisma.planChangeRequest.update({
    where: { id: requestId },
    data: { status: 'rejected', reviewedBy: platformUserId, reviewedAt: new Date(), reviewNote },
  });
}
