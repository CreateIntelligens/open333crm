import Redis from 'ioredis';
import { logger } from '../logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
});

redis.on('error', (err) => {
  logger.error('Redis error:', err);
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});
