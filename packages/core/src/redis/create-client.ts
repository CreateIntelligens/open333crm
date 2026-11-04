import IORedis, { type Redis, type RedisOptions } from 'ioredis';
import { logger } from '../logger/index.js';

// ioredis 為 CJS 套件：ESM 互通下 default 匯入可能落在 .default，兩種型態都要相容。
const RedisCtor = ((IORedis as any)?.default ?? IORedis) as new (url: string, opts?: RedisOptions) => Redis;

/**
 * - `command`：一般指令（快取、計數、短效代碼）。Redis 拒絕連線或不回應時，指令在時限內失敗。
 * - `queue`：BullMQ 與訂閱。BullMQ 要求 `maxRetriesPerRequest: null`，指令等到 Redis 恢復。
 */
export type RedisPurpose = 'command' | 'queue';

const OPTIONS: Record<RedisPurpose, RedisOptions> = {
  // 重試次數只在 Redis 拒絕連線時有效（約 0.2 秒失敗）；Redis 接受連線但不回應時只有 commandTimeout 擋得住
  command: { maxRetriesPerRequest: 2, commandTimeout: 1000 },
  queue: { maxRetriesPerRequest: null },
};

/** 各行程建立 Redis 連線都經過這裡，設定只寫在這個檔案。第一次執行指令時才連線。 */
export function createRedisClient(url: string, purpose: RedisPurpose): Redis {
  const client = new RedisCtor(url, { ...OPTIONS[purpose], lazyConnect: true });
  // 沒有 error listener 時，ioredis 把連線錯誤當成未處理的事件
  client.on('error', (err: Error) => logger.warn(`[Redis] ${purpose} client error: ${err.message}`));
  return client;
}
