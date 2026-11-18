/**
 * 留言私訊與公開回覆的限流（change add-comment-keyword-private-reply design D12）。
 *
 * 每個渠道一個 token bucket（Redis Lua，多個 API 實例共用）：
 * - 私訊 `cr:rate:pm:<channelId>`，補充速率＝每小時上限 ÷ 3600（每秒），容量＝每小時上限 ÷ 12
 * - 公開回覆 `cr:rate:pr:<channelId>`，數字來自平台設定 `publicReplyPerHour`
 * 固定時窗在整點前後可能 2 分鐘送出兩倍的量（超過 Meta 的每小時 750）；token bucket 讓送出平滑。
 *
 * Meta 回限流時以 pause() 暫停該渠道的 bucket（`estimated_time_to_regain_access`）。
 * 沒有 token 時回傳下一個 token 的等待時間，由消費者把 job 延後（不消耗重試次數）。
 */
import type { Redis } from 'ioredis';

export type RateBucketKind = 'pm' | 'pr';

export type RateTakeResult = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateGate {
  /** 取一個 token；perHour 來自平台設定 */
  take(kind: RateBucketKind, channelId: string, perHour: number, now?: number): Promise<RateTakeResult>;
  /** 暫停該渠道的 bucket ms 毫秒（Meta 回限流時） */
  pause(kind: RateBucketKind, channelId: string, ms: number, now?: number): Promise<void>;
}

export function rateBucketKey(kind: RateBucketKind, channelId: string): string {
  return `cr:rate:${kind}:${channelId}`;
}

export function ratePauseKey(kind: RateBucketKind, channelId: string): string {
  return `cr:rate:${kind}:${channelId}:paused`;
}

/** bucket 的容量與每毫秒補充量 */
export function bucketParams(perHour: number): { capacity: number; refillPerMs: number } {
  const hourly = Math.max(1, Math.floor(perHour));
  return { capacity: Math.max(1, hourly / 12), refillPerMs: hourly / 3_600_000 };
}

export interface BucketState {
  tokens: number;
  ts: number;
}

/**
 * 純函式版的 token bucket（與下方 Lua 相同的算法，單元測試與替身用）。
 * state 為 null 表示新的 bucket（滿的）。
 */
export function takeFromBucket(
  state: BucketState | null,
  now: number,
  perHour: number,
): { state: BucketState; result: RateTakeResult } {
  const { capacity, refillPerMs } = bucketParams(perHour);
  const prev = state ?? { tokens: capacity, ts: now };
  let tokens = Math.min(capacity, prev.tokens + Math.max(0, now - prev.ts) * refillPerMs);
  if (tokens >= 1) {
    tokens -= 1;
    return { state: { tokens, ts: now }, result: { ok: true } };
  }
  return { state: { tokens, ts: now }, result: { ok: false, retryAfterMs: Math.ceil((1 - tokens) / refillPerMs) } };
}

/**
 * KEYS[1] bucket（hash：tokens、ts），KEYS[2] 暫停到期時間
 * ARGV[1] now（毫秒）、ARGV[2] 容量、ARGV[3] 每毫秒補充量
 * 回傳 { 1, 0 }＝取到；{ 0, 等待毫秒 }＝沒有 token 或暫停中
 */
export const TOKEN_BUCKET_LUA = `
local now = tonumber(ARGV[1])
local paused = tonumber(redis.call('GET', KEYS[2]) or '0')
if paused > now then return {0, paused - now} end
local cap = tonumber(ARGV[2])
local rate = tonumber(ARGV[3])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil or ts == nil then tokens = cap; ts = now end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(cap, tokens + elapsed * rate)
local ok = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  ok = 1
else
  wait = math.ceil((1 - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate) + 60000)
return {ok, wait}
`;

export function createRedisRateGate(redis: Pick<Redis, 'eval' | 'set'>): RateGate {
  return {
    async take(kind, channelId, perHour, now = Date.now()) {
      const { capacity, refillPerMs } = bucketParams(perHour);
      const res = (await redis.eval(
        TOKEN_BUCKET_LUA,
        2,
        rateBucketKey(kind, channelId),
        ratePauseKey(kind, channelId),
        String(now),
        String(capacity),
        String(refillPerMs),
      )) as [number, number];
      return Number(res[0]) === 1 ? { ok: true } : { ok: false, retryAfterMs: Math.max(1, Number(res[1])) };
    },
    async pause(kind, channelId, ms, now = Date.now()) {
      if (ms <= 0) return;
      await redis.set(ratePauseKey(kind, channelId), String(now + ms), 'PX', ms);
    },
  };
}
