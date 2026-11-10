/**
 * 方案管理（平台側）。改 plan 的 features/limits 會影響該方案所有租戶的
 * 功能天花板與有效上限——features 變更需失效相關租戶的權限快取。
 */
import type { Redis } from 'ioredis';
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';
import { notFound } from '../../shared/messages/resource.js';
import { clearQuotaAlertFlags } from '../trial/token-quota.service.js';
import { monthlyTokensRaisedByPlanChange } from './plan-limits.service.js';

export async function listPlans(prisma: PrismaClient) {
  return prisma.plan.findMany({ orderBy: { priceMonthly: { sort: 'asc', nulls: 'last' } } });
}

/** 使用這個方案的租戶 ID：方案的功能或權限設定改變後，重新計算這些租戶已連線 socket 的渠道房間 */
export async function listTenantIdsOnPlan(prisma: PrismaClient, planId: string): Promise<string[]> {
  const tenants = await prisma.tenant.findMany({ where: { planId }, select: { id: true } });
  return tenants.map((t) => t.id);
}

export async function updatePlan(
  prisma: PrismaClient,
  redis: Redis,
  id: string,
  data: {
    name?: string;
    features?: string[];
    limits?: Record<string, number | null>;
    allowedChannelTypes?: string[];
    permissionOverrides?: { deny: string[] };
    priceMonthly?: number | null;
    isActive?: boolean;
  },
) {
  const existing = await prisma.plan.findUnique({ where: { id } });
  if (!existing) throw new AppError(notFound('plan'), 'NOT_FOUND', 404);

  const plan = await prisma.plan.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.features !== undefined ? { features: data.features as Prisma.InputJsonValue } : {}),
      ...(data.limits !== undefined ? { limits: data.limits as Prisma.InputJsonValue } : {}),
      ...(data.allowedChannelTypes !== undefined
        ? { allowedChannelTypes: data.allowedChannelTypes as Prisma.InputJsonValue }
        : {}),
      ...(data.permissionOverrides !== undefined
        ? { permissionOverrides: data.permissionOverrides as Prisma.InputJsonValue }
        : {}),
      ...(data.priceMonthly !== undefined ? { priceMonthly: data.priceMonthly } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  // features 或 permissionOverrides 變更 → 天花板變動 → 失效該方案所有租戶的權限快取
  if (data.features !== undefined || data.permissionOverrides !== undefined) {
    await invalidatePlanPermissions(redis, id);
  }
  if (data.limits !== undefined) await clearAlertsWhereQuotaRaised(prisma, redis, existing, data.limits);
  return plan;
}

/**
 * 方案的 limits 改變後，AI 月額度提高的租戶清掉本月的告警旗標，用量跨越新上限的門檻才會再通知（AUDIT PLAN-13）。
 * 覆寫了 monthlyTokens 的租戶上限不變，不清。
 */
async function clearAlertsWhereQuotaRaised(
  prisma: PrismaClient,
  redis: Redis,
  before: { id: string; limits: unknown },
  newLimits: Record<string, number | null>,
) {
  // 方案本身的額度沒有提高時，沒有任何租戶的上限會提高（覆寫的租戶不受方案影響），不必查租戶
  if (!monthlyTokensRaisedByPlanChange({ limitOverrides: {}, plan: before }, { limits: newLimits })) return;
  const tenants = await prisma.tenant.findMany({ where: { planId: before.id }, select: { id: true, limitOverrides: true } });
  for (const t of tenants) {
    if (monthlyTokensRaisedByPlanChange({ limitOverrides: t.limitOverrides, plan: before }, { limits: newLimits })) {
      await clearQuotaAlertFlags(redis, t.id);
    }
  }
}
