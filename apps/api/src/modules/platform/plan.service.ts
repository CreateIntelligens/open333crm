/**
 * 方案管理（平台側）。改 plan 的 features/limits 會影響該方案所有租戶的
 * 功能天花板與有效上限——features 變更需失效相關租戶的權限快取。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';

export async function listPlans(prisma: PrismaClient) {
  return prisma.plan.findMany({ orderBy: { priceMonthly: { sort: 'asc', nulls: 'last' } } });
}

export async function updatePlan(
  prisma: PrismaClient,
  id: string,
  data: {
    name?: string;
    features?: string[];
    limits?: Record<string, number | null>;
    priceMonthly?: number | null;
    isActive?: boolean;
  },
) {
  const existing = await prisma.plan.findUnique({ where: { id } });
  if (!existing) throw new AppError('Plan not found', 'NOT_FOUND', 404);

  const plan = await prisma.plan.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.features !== undefined ? { features: data.features as Prisma.InputJsonValue } : {}),
      ...(data.limits !== undefined ? { limits: data.limits as Prisma.InputJsonValue } : {}),
      ...(data.priceMonthly !== undefined ? { priceMonthly: data.priceMonthly } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  // features 變更 → 天花板變動 → 失效該方案所有租戶的權限快取
  if (data.features !== undefined) {
    await invalidatePlanPermissions(prisma, id);
  }
  return plan;
}
