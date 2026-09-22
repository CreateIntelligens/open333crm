/**
 * Scheduler 分散式鎖（水平擴展前必修）。
 *
 * 問題：scheduler 用 setInterval 在每個 API 進程內跑，多實例會重複執行
 * （重寄信 / 重複匯總 / 廣播重送）。
 *
 * 解法：每輪 poll 前用 Redis `SET NX PX` 搶「該任務的鎖」，只有搶到的實例執行。
 * 鎖帶 TTL（略小於 poll 間隔），到期自動釋放——即使持鎖實例崩潰也不會永久卡死；
 * 任務跑完主動釋放（用 value 比對確保只釋放自己的鎖，避免誤刪別人剛搶到的）。
 *
 * 這是「best-effort leader per tick」——非嚴格互斥（Redlock 那種），但對
 * 「重複執行只是浪費 / 靠 DB 冪等兜底」的 scheduler 足夠，且零額外依賴。
 */
import { redis } from '@open333crm/core';
import { logger } from '@open333crm/core';

// 每個實例的識別（同進程多次呼叫共用；跨進程不同）。避免 Date.now/random（環境限制外的一般 runtime 可用）。
const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 嘗試以 leader 身分執行 fn：搶到鎖才跑，否則跳過（其他實例會跑）。
 *
 * @param name    任務名（鎖 key = scheduler-lock:{name}）
 * @param ttlMs   鎖存活毫秒（建議 = poll 間隔 * 0.9，確保下輪前釋放/過期）
 * @param fn      實際任務
 */
export async function withLeaderLock(name: string, ttlMs: number, fn: () => Promise<void>): Promise<void> {
  const key = `scheduler-lock:${name}`;
  let acquired = false;
  try {
    const res = await redis.set(key, INSTANCE_ID, 'PX', ttlMs, 'NX');
    acquired = res === 'OK';
  } catch (err) {
    // Redis 掛掉時：保守選擇「照跑」（單機退化），避免整個 scheduler 停擺。
    // 多實例 + Redis 全掛的場景極少，且 DB 冪等仍是最終防線。
    logger.warn(`[SchedulerLock] redis unavailable for "${name}", running without lock:`, err);
    await fn();
    return;
  }

  if (!acquired) return; // 別的實例是 leader，跳過本輪

  try {
    await fn();
  } finally {
    // 只釋放自己的鎖（value 比對），避免誤刪別人在 TTL 過期後剛搶到的鎖。
    try {
      const lua =
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      await redis.eval(lua, 1, key, INSTANCE_ID);
    } catch {
      /* 釋放失敗靠 TTL 兜底 */
    }
  }
}
