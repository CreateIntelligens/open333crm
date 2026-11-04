import { logger } from '../logger/index.js';
import { createRedisClient } from './create-client.js';

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

// 一般用途的連線。lazyConnect：第一次執行指令時才連線，import core 的行程與測試檔若沒有用到 Redis，就不連線（#327）。
// 使用者改為由入口注入連線之後移除（#443、#337）。
export const redis = createRedisClient(REDIS_URL, 'command');

redis.on('connect', () => {
  logger.info('Connected to Redis');
});
