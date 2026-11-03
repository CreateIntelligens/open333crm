/**
 * 方案管理（平台側）。改 plan 的 features/limits 會影響該方案所有租戶的
 * 功能天花板與有效上限——features 變更需失效相關租戶的權限快取。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';
import { notFound } from '../../shared/messages/resource.js';

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
    await invalidatePlanPermissions(prisma, id);
  }
  return plan;
}
