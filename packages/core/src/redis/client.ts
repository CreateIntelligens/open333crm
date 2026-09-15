import IORedis, { type Redis } from 'ioredis';
import { logger } from '../logger/index.js';

// ioredis 為 CJS 套件：ESM 互通下 default 匯入可能落在 .default，兩種型態都要相容。
// 以 any 橋接建構子型別，避免 TS 在 ESM 解析下判定不可建構。
const RedisCtor = ((IORedis as any)?.default ?? IORedis) as new (
  url: string,
  opts?: Record<string, unknown>,
) => Redis;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

export const redis = new RedisCtor(REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
});

redis.on('error', (err: Error) => {
  logger.error('Redis error:', err);
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});
