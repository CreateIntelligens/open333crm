/**
 * 平台側試用用戶管理：列試用租戶、延長、轉正式、申請記錄操作。
 * 平台 superuser 專用（呼叫端已掛 guard）。
 */
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { resendTrial } from '../trial/trial.service.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';
import { invalidateTenantPlan } from '../../services/tenant-plan.cache.js';

/** 列試用租戶（trialEndsAt 非 null），含剩餘天數與狀態。 */
export async function listTrialTenants(prisma: PrismaClient) {
  const tenants = await prisma.tenant.findMany({
    where: { trialEndsAt: { not: null } },
    select: {
      id: true,
      name: true,
      isActive: true,
      trialEndsAt: true,
      purgedAt: true,
      createdAt: true,
      plan: { select: { slug: true, name: true } },
      _count: { select: { agents: true } },
    },
    orderBy: { trialEndsAt: 'asc' },
  });

  const now = Date.now();
  return tenants.map((t) => {
    const daysLeft = t.trialEndsAt
      ? Math.ceil((t.trialEndsAt.getTime() - now) / 86400_000)
      : null;
    // 狀態：已軟刪=purged；停用=已到期停用；否則依剩餘天數
    let status: 'active' | 'expiring' | 'expired' | 'disabled' | 'purged';
    if (t.purgedAt) status = 'purged';
    else if (!t.isActive) status = 'disabled';
    else if (daysLeft !== null && daysLeft <= 0) status = 'expired';
    else if (daysLeft !== null && daysLeft <= 3) status = 'expiring';
    else status = 'active';

    return {
      id: t.id,
      name: t.name,
      isActive: t.isActive,
      trialEndsAt: t.trialEndsAt,
      purgedAt: t.purgedAt,
      daysLeft,
      status,
      planName: t.plan?.name ?? null,
      agentCount: t._count.agents,
    };
  });
}

/**
 * 復原已軟刪的試用租戶：清 purgedAt（不動 isActive，仍維持停用）。
 * 業務資料本就未真刪（軟刪只標記），復原即讓平台方重新看到其非「已清除」狀態。
 * 稽核由呼叫端（route）以 writePlatformAudit 記錄（含 platformUserId），此處不重複寫。
 */
export async function restorePurgedTenant(prisma: PrismaClient, tenantId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, purgedAt: true } });
  if (!t) throw new AppError('租戶不存在', 'NOT_FOUND', 404);
  if (!t.purgedAt) throw new AppError('該租戶未被軟刪，無需復原', 'NOT_PURGED', 422);

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { purgedAt: null },
    select: { id: true, name: true, purgedAt: true, isActive: true },
  });
  return updated;
}

/**
 * 更新租戶合約起訖日（純記錄，不觸發任何自動生命週期行為）。
 * 兩者皆 optional：傳 undefined 不動該欄、傳 null 清除、傳 Date 設值。
 * 若更新後兩者皆有值，迄日 MUST >= 起日（於此擋並回 422 CONTRACT_DATE_INVALID，
 * 合併現有值比對——傳單一日期也會跟 DB 現值檢查；route 不再另做 Zod refine）。
 */
export async function updateTenantContract(
  prisma: PrismaClient,
  tenantId: string,
  input: { contractStartDate?: Date | null; contractEndDate?: Date | null },
) {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, contractStartDate: true, contractEndDate: true },
  });
  if (!t) throw new AppError('Tenant not found', 'NOT_FOUND', 404);

  // 合併「傳入值」與「現有值」後檢查起訖合理性（undefined 表示不動）
  const start = input.contractStartDate === undefined ? t.contractStartDate : input.contractStartDate;
  const end = input.contractEndDate === undefined ? t.contractEndDate : input.contractEndDate;
  if (start && end && end < start) {
    throw new AppError('合約迄日不可早於起日', 'CONTRACT_DATE_INVALID', 422);
  }

  return prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ...(input.contractStartDate !== undefined ? { contractStartDate: input.contractStartDate } : {}),
      ...(input.contractEndDate !== undefined ? { contractEndDate: input.contractEndDate } : {}),
    },
    select: { id: true, name: true, contractStartDate: true, contractEndDate: true },
  });
}

/** 延長試用：把 trialEndsAt 往後推 N 天（從現有到期日或今天取較晚者起算，避免縮短）。 */
export async function extendTrial(prisma: PrismaClient, tenantId: string, addDays: number) {
  if (addDays <= 0) throw new AppError('addDays 必須為正整數', 'BAD_REQUEST', 400);
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { trialEndsAt: true },
  });
  if (!t) throw new AppError('Tenant not found', 'NOT_FOUND', 404);
  if (!t.trialEndsAt) throw new AppError('此租戶非試用租戶', 'NOT_TRIAL', 400);

  // 從「現有到期日」與「今天」取較晚者起算——已到期的租戶延長從今天算
  const base = Math.max(t.trialEndsAt.getTime(), Date.now());
  const newEnd = new Date(base + addDays * 86400_000);
  return prisma.tenant.update({
    where: { id: tenantId },
    data: {
      trialEndsAt: newEnd,
      isActive: true, // 延長 = 恢復啟用（若已到期停用）
      trialRemindersSent: [], // 重設提醒標記，新週期重新提醒
    },
    select: { id: true, name: true, trialEndsAt: true, isActive: true },
  });
}

/** 轉正式方案：改 planId + 清 trialEndsAt（脫離試用）+ 確保啟用。 */
export async function convertToPaid(prisma: PrismaClient, tenantId: string, planSlug: string) {
  const plan = await prisma.plan.findUnique({ where: { slug: planSlug }, select: { id: true, slug: true } });
  if (!plan) throw new AppError('Plan not found', 'NOT_FOUND', 404);
  if (plan.slug === 'trial') throw new AppError('不能轉成試用方案', 'BAD_REQUEST', 400);

  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!t) throw new AppError('Tenant not found', 'NOT_FOUND', 404);

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      planId: plan.id,
      trialEndsAt: null, // 清 = 脫離試用，不再受到期排程管轄
      isActive: true,
    },
    select: { id: true, name: true, plan: { select: { name: true } } },
  });

  // 方案變動 → 失效權限天花板快取 + 租戶 plan 快取（比照 plan-change.service 升級路徑）。
  // 未失效的話 guard 會在 60s 內沿用舊 trial 天花板，把剛付費租戶的新功能誤擋 403。
  // update 非 transaction，直接在成功寫入後失效即可。
  await invalidatePlanPermissions(prisma, plan.id);
  invalidateTenantPlan(tenantId);

  return updated;
}

/** 重寄驗證信（平台側觸發；繞過使用者節流，避免管理員操作靜默失敗）。 */
export async function resendVerification(prisma: PrismaClient, signupId: string) {
  const row = await prisma.trialSignup.findUnique({ where: { id: signupId }, select: { email: true, status: true } });
  if (!row) throw new AppError('Signup not found', 'NOT_FOUND', 404);
  if (row.status !== 'pending_verification') {
    throw new AppError('此申請非待驗證狀態', 'BAD_REQUEST', 400);
  }
  await resendTrial(prisma, row.email, { bypassThrottle: true });
  return { ok: true };
}

/** 手動標記申請為 failed（排查/作廢用）。 */
export async function markSignupFailed(prisma: PrismaClient, signupId: string, reason: string) {
  const row = await prisma.trialSignup.findUnique({ where: { id: signupId }, select: { status: true } });
  if (!row) throw new AppError('Signup not found', 'NOT_FOUND', 404);
  if (row.status === 'provisioned') {
    throw new AppError('已開通的申請不可標記為 failed', 'BAD_REQUEST', 400);
  }
  return prisma.trialSignup.update({
    where: { id: signupId },
    data: { status: 'failed', failureReason: reason || '平台手動作廢', verifyTokenHash: null },
    select: { id: true, status: true, failureReason: true },
  });
}
