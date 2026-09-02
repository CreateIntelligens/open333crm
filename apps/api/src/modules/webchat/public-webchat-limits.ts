import { createHash } from 'node:crypto';

interface LimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, LimitBucket>();

export interface PublicWebchatLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function getPublicWebchatKey(scope: string, value: string): string {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex');
}

export function consumePublicWebchatLimit(
  key: string,
  max: number,
  now = Date.now(),
  windowMs = 60_000,
): PublicWebchatLimitResult {
  if (buckets.size >= 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetPublicWebchatLimits(): void {
  buckets.clear();
}
