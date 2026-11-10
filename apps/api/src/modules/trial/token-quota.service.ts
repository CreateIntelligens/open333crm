/**
 * Token 月額度即時硬擋（Redis 計數器版）。
 *
 * 計數器 key `aiquota:{tenantId}:{YYYY-MM}`，每次成功 AI 呼叫 incrby totalTokens，
 * 首次寫入設月底過期。硬擋檢查讀 Redis 計數器（miss 時從 DB 回填初始化）。
 * Redis 不可用時 fallback 回 DB 當月加總，不阻斷主流程。
 *
 * BYOK（租戶自備 key）的 token 不計入額度、也不擋——成本租戶自付，平台不該擋。
 * 故計數器只累加 keySource=platform 的呼叫（見 incrMonthlyTokens 的呼叫端）。
 *
 * 讀資料庫的函式收 TenantCtx；讀寫 Redis 的函式收呼叫端傳入的 redis，在交易外呼叫
 * （change migrate-ai-llm-tenant-ctx，design D3）。計數器不存在時，Redis 函式呼叫 readDbTotal()
 * 取資料庫的加總，readDbTotal 由 flow 傳入，flow 在其中另開一個短交易。
 */
import type { Redis } from 'ioredis';
import { logger } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

/** 用量告警門檻：達額度百分比時各發一次通知。critical=100%（已耗盡）。 */
export const QUOTA_ALERT_THRESHOLDS = [
  { level: 'warning', pct: 0.8 },
  { level: 'critical', pct: 1.0 },
] as const;

export type QuotaAlertLevel = (typeof QUOTA_ALERT_THRESHOLDS)[number]['level'];

/** 計數器不存在時取資料庫當月加總的函式 */
export type ReadDbTotal = () => Promise<number>;

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

/** DB 當月 platform key 成功呼叫的 token 加總（Redis miss / 初始化 / Redis 無法使用時用）。 */
export async function readMonthlyTokensFromDb(ctx: TenantCtx): Promise<number> {
  const agg = await ctx.tx.aiUsage.aggregate({
    where: { tenantId: ctx.tenantId, success: true, keySource: 'platform', createdAt: { gte: monthStart() } },
    _sum: { totalTokens: true },
  });
  return agg._sum.totalTokens ?? 0;
}

/**
 * 取當月已用 token（優先 Redis 計數器）。
 * Redis 無此 key 時從 DB 回填並設月底過期；Redis 掛掉時直接回 DB 值。
 */
export async function readMonthlyTokens(redis: Redis, tenantId: string, readDbTotal: ReadDbTotal): Promise<number> {
  const key = counterKey(tenantId);
  let dbTotal: number | undefined;
  try {
    const cached = await redis.get(key);
    if (cached !== null) return Number(cached);
    // 初始化：從 DB 回填 + 設月底過期。
    // 用 SET NX（只在 key 不存在時寫入）避免覆蓋並發 incrMonthlyTokens 已建立並累加的計數器：
    // 若在 get()→null 後、set 之前有 incr 先建好 key，無條件 set(dbTotal) 會把它蓋回舊值（lost-update）。
    // NX 搶到（回 'OK'）→ 回填值即當前值；沒搶到（回 null）→ 別人已建好，改讀該最新值。
    dbTotal = await readDbTotal();
    const setResult = await redis.set(key, dbTotal, 'PXAT', nextMonthStart().getTime(), 'NX');
    if (setResult === null) {
      // 別人剛建好計數器（可能已含更新的累加值），改讀它；讀不到才退回 dbTotal。
      const latest = await redis.get(key);
      return latest !== null ? Number(latest) : dbTotal;
    }
    return dbTotal;
  } catch (err) {
    logger.warn('[TokenQuota] redis unavailable, fallback to DB:', err);
    return dbTotal ?? readDbTotal();
  }
}

/**
 * 成功呼叫後即時累加（只累加 platform key；BYOK 不計）。在 AiUsage commit 之後呼叫。
 * 回傳累加後的計數器總量（供告警門檻偵測）；Redis 不可用或 tokens<=0 時回 null（跳過偵測）。
 */
export async function incrMonthlyTokens(
  redis: Redis,
  tenantId: string,
  tokens: number,
  readDbTotal: ReadDbTotal,
): Promise<number | null> {
  if (tokens <= 0) return null;
  const key = counterKey(tenantId);
  try {
    const exists = await redis.exists(key);
    if (!exists) {
      // 計數器不存在（月初 / Redis 重啟 / key 過期）時從 DB 回填。
      // 呼叫端在 AiUsage commit 之後才累加，readDbTotal() 的加總「已包含本次 tokens」。
      //
      // 用 SET NX（只在 key 不存在時寫入）避免併發 lost-update：
      // 兩個並發 incr 都見 exists=false 時，若都無條件 set(dbTotal)，較晚者會覆蓋較早者的
      // incrby；而各自算的 dbTotal 只含「自己那次」的用量（另一次可能還沒被對方讀進 DB 加總），
      // 於是有一次 tokens 被吞掉（計數器低估、fail-open 少擋）。
      const dbTotal = await readDbTotal();
      const setResult = await redis.set(key, dbTotal, 'PXAT', nextMonthStart().getTime(), 'NX');
      if (setResult === null) {
        // NX 沒搶到 → 別人剛建好計數器；其初始值不含「本次 tokens」（本次可能還沒進對方的 DB
        // 加總），故補做一次 incrby(tokens) 才不會漏算。incrby 回傳累加後總量。
        return await redis.incrby(key, tokens);
      }
      // NX 搶到（key 原本不存在）→ dbTotal 已含本次 tokens，不再 incrby，避免雙重計數。
      return dbTotal;
    }
    // 計數器已存在：正常即時累加本次 tokens。incrby 回傳累加後總量。
    return await redis.incrby(key, tokens);
  } catch (err) {
    logger.warn('[TokenQuota] redis incr failed (額度仍靠 DB 兜底):', err);
    return null;
  }
}

/** 超過月額度時回 true（呼叫端據此擋 AI）。limit 是 null（沒有上限）時一律回 false，不讀計數器。 */
export async function isMonthlyTokenExceeded(
  redis: Redis,
  tenantId: string,
  limit: number | null,
  readDbTotal: ReadDbTotal,
): Promise<boolean> {
  if (limit === null) return false;
  return (await readMonthlyTokens(redis, tenantId, readDbTotal)) >= limit;
}

/** 用量告警旗標 key：aiquota-alert:{tenantId}:{YYYY-MM}:{level}。 */
function alertFlagKey(tenantId: string, level: QuotaAlertLevel): string {
  return `aiquota-alert:${tenantId}:${monthKey()}:${level}`;
}

/** 剛跨越的告警門檻（已搶到冪等旗標，代表本月本 level 尚未發過）。 */
export interface CrossedThreshold {
  level: QuotaAlertLevel;
  limitTokens: number;
  usedTokens: number;
  monthKey: string;
}

/**
 * 偵測本次累加是否「剛跨越」任一告警門檻，並以 Redis 旗標做冪等（每租戶每月每 level 僅一次）。
 * after=累加後總量、tokensAdded=本次量 → before=after-tokensAdded；門檻判斷 before<門檻 && after>=門檻。
 * limit 是呼叫 LLM 之前讀到的上限；無上限（limit===null）回 []。單次巨量可同時跨越 warning 與 critical，皆回傳（不漏門檻）。
 */
export async function claimCrossedThresholds(
  redis: Redis,
  tenantId: string,
  limit: number | null,
  tokensAdded: number,
  after: number,
): Promise<CrossedThreshold[]> {
  if (limit === null) return [];
  const before = after - tokensAdded;
  const crossed: CrossedThreshold[] = [];
  for (const { level, pct } of QUOTA_ALERT_THRESHOLDS) {
    const thresholdTokens = Math.ceil(limit * pct);
    if (before < thresholdTokens && after >= thresholdTokens) {
      // 冪等搶佔：SET NX + 月底過期（跨月自動重置）。僅搶到者納入回傳。
      try {
        const ok = await redis.set(
          alertFlagKey(tenantId, level),
          '1',
          'PXAT',
          nextMonthStart().getTime(),
          'NX',
        );
        if (ok === 'OK') {
          crossed.push({ level, limitTokens: limit, usedTokens: after, monthKey: monthKey() });
        }
      } catch (err) {
        // 第一個指令失敗就停止：Redis 不回應時，告警最多讓回覆多等一個指令的逾時（spec usage-quota-alerts）。
        // 已經認領到的門檻照樣回傳
        logger.warn('[TokenQuota] alert flag set failed, skip remaining thresholds:', err);
        break;
      }
    }
  }
  return crossed;
}

/** 清某租戶當月的用量計數器。下次讀取時，系統從 `AiUsage` 的加總補建計數器。`approveRequest()` 核准加購時呼叫這個函式，校正少算的用量（AUDIT USAGE-03）。 */
export async function clearTokenQuotaCache(redis: Redis, tenantId: string): Promise<void> {
  try {
    await redis.del(counterKey(tenantId));
  } catch (err) {
    logger.warn('[TokenQuota] clear counter failed, skip:', err);
  }
}

/** 清某租戶當月所有告警旗標。核准加購提高上限後呼叫，讓新上限的門檻可以再次告警。 */
export async function clearQuotaAlertFlags(redis: Redis, tenantId: string): Promise<void> {
  try {
    await Promise.all(
      QUOTA_ALERT_THRESHOLDS.map(({ level }) => redis.del(alertFlagKey(tenantId, level))),
    );
  } catch (err) {
    logger.warn('[TokenQuota] clear alert flags failed, skip:', err);
  }
}
