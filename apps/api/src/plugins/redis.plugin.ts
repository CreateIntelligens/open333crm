import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { closeSharedRedis, getSharedRedis } from '../lib/redis-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 一般用途的 Redis 連線（快取、計數、短效代碼）。入口取得後傳給 flow；不能用於訂閱或 BullMQ。 */
    redis: Redis;
  }
}

// 註冊時不連 Redis，第一次執行指令才連線：沒有 Redis 的環境也能建立應用程式（#439）
async function redisPlugin(fastify: FastifyInstance) {
  fastify.decorate('redis', getSharedRedis());
  fastify.addHook('onClose', () => closeSharedRedis());
}

export default fp(redisPlugin, { name: 'redis' });
