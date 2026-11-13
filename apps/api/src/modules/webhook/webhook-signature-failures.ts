/**
 * Meta webhook 驗簽失敗的計數（change add-comment-keyword-private-reply design D25 `meta-webhook-signature` 告警）。
 *
 * 每 5 分鐘一個 Redis 計數鍵；comment-reply-health 排程讀上一個與目前的時段，5 分鐘內 ≥ 50 次就發 ops-alert
 * （App Secret 被換掉、或有人在灌假請求）。計數失敗只略過，不影響 webhook。
 */
import type { Redis } from 'ioredis';

export const SIGNATURE_FAILURE_BUCKET_MS = 5 * 60_000;

export function signatureFailureKey(at: number = Date.now()): string {
  return `cr:sigfail:${Math.floor(at / SIGNATURE_FAILURE_BUCKET_MS)}`;
}

export async function recordMetaSignatureFailure(redis: Pick<Redis, 'incr' | 'expire'> | undefined, at: number = Date.now()): Promise<void> {
  if (!redis) return;
  const key = signatureFailureKey(at);
  try {
    await redis.incr(key);
    await redis.expire(key, 3600);
  } catch {
    // 計數只是監控用，失敗不影響 webhook
  }
}
