/**
 * 試用 token 額度硬擋（簡化版）。
 * 當租戶有效 monthlyTokens 非無上限時，查當月 AiUsage totalTokens 加總，
 * 達上限即擋 AI 回覆（真人回覆不受影響）。
 * 60s 進程快取當月用量減壓；正式的 Redis 即時計數器屬後續 change。
 */
import type { PrismaClient } from '@prisma/client';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';

const CACHE_TTL_MS = 60_000;
const usageCache = new Map<string, { total: number; expiresAt: number }>();

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function monthlyTokenSum(prisma: PrismaClient, tenantId: string): Promise<number> {
  const hit = usageCache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.total;

  const agg = await prisma.aiUsage.aggregate({
    where: { tenantId, success: true, createdAt: { gte: monthStart() } },
    _sum: { totalTokens: true },
  });
  const total = agg._sum.totalTokens ?? 0;
  usageCache.set(tenantId, { total, expiresAt: Date.now() + CACHE_TTL_MS });
  return total;
}

/** 若超過月額度回 true（呼叫端據此擋 AI）。無上限或無 plan 一律回 false。 */
export async function isMonthlyTokenExceeded(prisma: PrismaClient, tenantId: string): Promise<boolean> {
  const limit = await getEffectiveLimit(prisma, tenantId, 'monthlyTokens');
  if (limit === null) return false;
  const used = await monthlyTokenSum(prisma, tenantId);
  return used >= limit;
}

/** 測試/寫入後清快取。 */
export function clearTokenQuotaCache(): void {
  usageCache.clear();
}
