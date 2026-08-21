/**
 * 租戶 → planId 的短期進程內快取。
 * guard 每次請求都要知道租戶方案（決定天花板），但 planId 極少變動，
 * 用 60s 進程快取避免每次打 DB。改租戶方案時呼叫 invalidateTenantPlan。
 */
import type { PrismaClient } from '@prisma/client';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { planId: string | null; expiresAt: number }>();

export async function getTenantPlanId(
  prisma: PrismaClient,
  tenantId: string | null | undefined,
): Promise<string | null> {
  if (!tenantId) return null;
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.planId;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { planId: true },
  });
  const planId = tenant?.planId ?? null;
  cache.set(tenantId, { planId, expiresAt: Date.now() + CACHE_TTL_MS });
  return planId;
}

export function invalidateTenantPlan(tenantId: string): void {
  cache.delete(tenantId);
}
