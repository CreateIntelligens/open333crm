/**
 * 方案升級/加購申請（租戶發起 → 平台審核核准）。
 * - upgrade：核准後改 tenant.planId + 失效權限快取
 * - token_topup：核准後把加購量加進 tenant.limitOverrides.monthlyTokens（在方案額度之上）
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';
import { invalidateTenantPlan } from '../../services/tenant-plan.cache.js';
import { clearTokenQuotaCache } from '../trial/token-quota.service.js';

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

/** 租戶查自己的申請。 */
export async function listTenantPlanChangeRequests(prisma: PrismaClient, tenantId: string) {
  return prisma.planChangeRequest.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

// ── 平台側 ──

/** 平台列待審申請（含租戶名/方案）。 */
export async function listPendingRequests(prisma: PrismaClient) {
  const rows = await prisma.planChangeRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: { tenant: { select: { name: true, plan: { select: { slug: true, name: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenant.name,
    currentPlan: r.tenant.plan?.name ?? null,
    type: r.type,
    targetPlanSlug: r.targetPlanSlug,
    topupTokens: r.topupTokens,
    note: r.note,
    createdAt: r.createdAt,
  }));
}

/** 核准申請：upgrade 改方案、token_topup 提高額度。 */
export async function approveRequest(
  prisma: PrismaClient,
  requestId: string,
  platformUserId: string,
  reviewNote?: string,
) {
  const req = await prisma.planChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError('申請不存在', 'NOT_FOUND', 404);
  if (req.status !== 'pending') throw new AppError('此申請已處理', 'BAD_REQUEST', 400);

  if (req.type === 'upgrade') {
    const plan = await prisma.plan.findUnique({ where: { slug: req.targetPlanSlug! }, select: { id: true } });
    if (!plan) throw new AppError('目標方案不存在', 'NOT_FOUND', 404);
    await prisma.tenant.update({ where: { id: req.tenantId }, data: { planId: plan.id } });
    // 方案變動 → 失效權限天花板快取 + 租戶 plan 快取
    await invalidatePlanPermissions(prisma, plan.id);
    invalidateTenantPlan(req.tenantId);
  } else {
    // token_topup：把加購量加進 limitOverrides.monthlyTokens（在方案額度之上）
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { limitOverrides: true, plan: { select: { limits: true } } },
    });
    const overrides = (tenant?.limitOverrides ?? {}) as Record<string, number | null>;
    const planLimits = (tenant?.plan?.limits ?? {}) as Record<string, number | null>;
    // 現有有效額度 = override ?? plan
    const current =
      overrides.monthlyTokens !== undefined
        ? overrides.monthlyTokens
        : planLimits.monthlyTokens ?? null;
    // 無上限時加購無意義：擋核准並提示，避免管理員誤以為加購已生效
    if (current === null) {
      throw new AppError('此租戶方案 AI 額度已為無上限，無需加購', 'TOPUP_UNLIMITED', 400);
    }
    overrides.monthlyTokens = current + (req.topupTokens ?? 0);
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { limitOverrides: overrides as Prisma.InputJsonValue },
    });
    invalidateTenantPlan(req.tenantId);
    await clearTokenQuotaCache(req.tenantId); // 讓硬擋重讀新額度
  }

  return prisma.planChangeRequest.update({
    where: { id: requestId },
    data: { status: 'approved', reviewedBy: platformUserId, reviewedAt: new Date(), reviewNote },
  });
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
