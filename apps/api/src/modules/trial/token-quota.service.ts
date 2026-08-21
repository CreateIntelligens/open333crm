/**
 * Token 月額度即時硬擋（Redis 計數器版）。
 *
 * 計數器 key `aiquota:{tenantId}:{YYYY-MM}`，每次成功 AI 呼叫 incrby totalTokens，
 * 首次寫入設月底過期。硬擋檢查讀 Redis 計數器（miss 時從 DB 回填初始化）。
 * Redis 不可用時 fallback 回 DB 當月加總，不阻斷主流程。
 *
 * BYOK（租戶自備 key）的 token 不計入額度、也不擋——成本租戶自付，平台不該擋。
 * 故計數器只累加 keySource=platform 的呼叫（見 incrMonthlyTokens 的呼叫端）。
 */
import type { PrismaClient } from '@prisma/client';
import { redis, logger } from '@open333crm/core';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';

function monthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
function counterKey(tenantId: string): string {
  return `aiquota:${tenantId}:${monthKey()}`;
}
function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** DB 當月 platform key token 加總（Redis miss / 初始化用）。 */
async function dbMonthlyTokens(prisma: PrismaClient, tenantId: string): Promise<number> {
  const agg = await prisma.aiUsage.aggregate({
    where: { tenantId, success: true, keySource: 'platform', createdAt: { gte: monthStart() } },
    _sum: { totalTokens: true },
  });
  return agg._sum.totalTokens ?? 0;
}

/**
 * 取當月已用 token（優先 Redis 計數器）。
 * Redis 無此 key 時從 DB 回填並設月底過期；Redis 掛掉時直接回 DB 值。
 */
async function getMonthlyTokens(prisma: PrismaClient, tenantId: string): Promise<number> {
  const key = counterKey(tenantId);
  try {
    const cached = await redis.get(key);
    if (cached !== null) return Number(cached);
    // 初始化：從 DB 回填 + 設月底過期
    const dbTotal = await dbMonthlyTokens(prisma, tenantId);
    await redis.set(key, dbTotal, 'PXAT', nextMonthStart().getTime());
    return dbTotal;
  } catch (err) {
    logger.warn('[TokenQuota] redis unavailable, fallback to DB:', err);
    return dbMonthlyTokens(prisma, tenantId);
  }
}

/** 成功呼叫後即時累加（只累加 platform key；BYOK 不計）。fire-and-forget。 */
export async function incrMonthlyTokens(prisma: PrismaClient, tenantId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const key = counterKey(tenantId);
  try {
    const exists = await redis.exists(key);
    if (!exists) {
      // 先回填 DB 值（避免計數器從 0 起算漏掉本月已累積）再累加
      const dbTotal = await dbMonthlyTokens(prisma, tenantId);
      await redis.set(key, dbTotal, 'PXAT', nextMonthStart().getTime());
    }
    await redis.incrby(key, tokens);
  } catch (err) {
    logger.warn('[TokenQuota] redis incr failed (額度仍靠 DB 兜底):', err);
  }
}

/** 若超過月額度回 true（呼叫端據此擋 AI）。無上限或無 plan 一律回 false。 */
export async function isMonthlyTokenExceeded(prisma: PrismaClient, tenantId: string): Promise<boolean> {
  const limit = await getEffectiveLimit(prisma, tenantId, 'monthlyTokens');
  if (limit === null) return false;
  const used = await getMonthlyTokens(prisma, tenantId);
  return used >= limit;
}

/** 測試用：清某租戶當月計數器。 */
export async function clearTokenQuotaCache(tenantId?: string): Promise<void> {
  try {
    if (tenantId) await redis.del(counterKey(tenantId));
  } catch {
    /* 忽略 */
  }
}
