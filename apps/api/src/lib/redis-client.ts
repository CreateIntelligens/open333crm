import IORedis from 'ioredis';
import { logger } from '@open333crm/core';
import { getConfig } from '../config/env.js';

let client: IORedis | null = null;

/**
 * API 行程共用的一般用途 Redis 連線（延遲建立）：短效代碼、登入計數、passkey challenge、
 * webhook 去重等 GET/SET 類操作。原本各模組各自 `new IORedis`，每個模組多開一條連線。
 *
 * 不用於 pub/sub 或 BullMQ：訂閱中的連線不能下一般指令，BullMQ 也要求自己的連線設定。
 * service 檔 import 這個模組，`scripts/check-tenant-ctx.mjs` 一樣算作直接使用 Redis client。
 */
export function getSharedRedis(): IORedis {
  if (!client) {
    client = new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
    client.on('error', (err: Error) => logger.warn('[Redis] shared client error', { error: err?.message }));
  }
  return client;
}
