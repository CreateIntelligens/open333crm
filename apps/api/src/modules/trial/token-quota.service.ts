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
    // 初始化：從 DB 回填 + 設月底過期。
    // 用 SET NX（只在 key 不存在時寫入）避免覆蓋並發 incrMonthlyTokens 已建立並累加的計數器：
    // 若在 get()→null 後、set 之前有 incr 先建好 key，無條件 set(dbTotal) 會把它蓋回舊值（lost-update）。
    // NX 搶到（回 'OK'）→ 回填值即當前值；沒搶到（回 null）→ 別人已建好，改讀該最新值。
    const dbTotal = await dbMonthlyTokens(prisma, tenantId);
    const setResult = await redis.set(key, dbTotal, 'PXAT', nextMonthStart().getTime(), 'NX');
    if (setResult === null) {
      // 別人剛建好計數器（可能已含更新的累加值），改讀它；讀不到才退回 dbTotal。
      const latest = await redis.get(key);
      return latest !== null ? Number(latest) : dbTotal;
    }
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
      // 計數器不存在（月初 / Redis 重啟 / key 過期）時從 DB 回填。
      // 呼叫端（recordAiUsage）已先 await prisma.aiUsage.create() 寫入本次用量，
      // dbMonthlyTokens 的加總「已包含本次 tokens」。
      //
      // 用 SET NX（只在 key 不存在時寫入）避免併發 lost-update：
      // 兩個並發 incr 都見 exists=false 時，若都無條件 set(dbTotal)，較晚者會覆蓋較早者的
      // incrby；而各自算的 dbTotal 只含「自己那次」的用量（另一次可能還沒被對方讀進 DB 加總），
      // 於是有一次 tokens 被吞掉（計數器低估、fail-open 少擋）。
      const dbTotal = await dbMonthlyTokens(prisma, tenantId);
      const setResult = await redis.set(key, dbTotal, 'PXAT', nextMonthStart().getTime(), 'NX');
      if (setResult === null) {
        // NX 沒搶到 → 別人剛建好計數器；其初始值不含「本次 tokens」（本次可能還沒進對方的 DB
        // 加總），故補做一次 incrby(tokens) 才不會漏算。
        await redis.incrby(key, tokens);
      }
      // NX 搶到（key 原本不存在）→ dbTotal 已含本次 tokens，不再 incrby，避免雙重計數。
      return;
    }
    // 計數器已存在：正常即時累加本次 tokens。
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
