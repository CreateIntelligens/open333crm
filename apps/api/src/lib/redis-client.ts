import { createRedisClient } from '@open333crm/core';
import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';

let client: Redis | null = null;

/**
 * API 行程的一般用途 Redis 連線（延遲建立）。`fastify.redis`（plugins/redis.plugin.ts）也是這一條。
 *
 * 新的程式從入口取得 `fastify.redis` 再傳下去，不要呼叫這個函式。拿不到 `fastify` 的使用者
 * （webhook 收訊流程、passkey、webhook 轉發去重）改為注入之後，刪除這個檔案（#443、#337）。
 * 刪除時，`plugins/redis.plugin.ts` 改為自己呼叫 `createRedisClient()`，並在 `onClose` 關閉連線。
 * service 檔 import 這個模組，`scripts/check-tenant-ctx.mjs` 一樣算作直接使用 Redis client。
 */
export function getSharedRedis(): Redis {
  client ??= createRedisClient(getConfig().REDIS_URL, 'command');
  return client;
}

/** 關閉連線；之後再取用時建立新的連線 */
export function closeSharedRedis(): void {
  client?.disconnect();
  client = null;
}
