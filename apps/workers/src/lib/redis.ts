import type { Redis } from 'ioredis';
import { createRedisClient } from '@open333crm/core';

export interface WorkerRedis {
  /** BullMQ 的 Queue 與 Worker 共用 */
  connection: Redis;
  /** 發布 socket 事件（`socket:emit`） */
  publisher: Redis;
}

export function createWorkerRedis(url: string): WorkerRedis {
  return {
    connection: createRedisClient(url, 'queue'),
    publisher: createRedisClient(url, 'command'),
  };
}
