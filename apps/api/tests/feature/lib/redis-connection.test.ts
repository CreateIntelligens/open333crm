/**
 * BullMQ 用途的 Redis 連線交給 BullMQ（change unify-redis-connection-api：redis-connection
 * 「BullMQ 與訂閱用途的連線不限制指令的等待時間」）。
 *
 * 需要真的 Redis：Worker 在連上 Redis 之前關閉的話，BullMQ 呼叫的 connect() 會留下未處理的 rejection。
 * 其他 scenario 不需要 Redis，見 packages/core/tests/unit/redis/create-redis-client.test.ts。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { test } from 'vitest';
import { createRedisClient } from '@open333crm/core';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error('redis-connection 需要 REDIS_URL，由 tests/setup/feature.env.ts 提供');

test('交給 BullMQ 的 Worker：BullMQ 用途的連線建立 Worker 不報錯', async () => {
  const connection = createRedisClient(REDIS_URL, 'queue');
  try {
    const worker = new Worker(`redis-connection-test-${randomUUID()}`, null, { connection, autorun: false });
    await worker.waitUntilReady();
    await worker.close();
  } finally {
    connection.disconnect();
  }
});

test('一般用途的連線交給 BullMQ 的 Worker 時，BullMQ 回報連線設定錯誤', () => {
  // 對照組：確認上一項測的是設定，不是 Worker 根本不檢查
  const connection = createRedisClient(REDIS_URL, 'command');
  try {
    assert.throws(
      () => new Worker(`redis-connection-test-${randomUUID()}`, null, { connection, autorun: false }),
      /maxRetriesPerRequest must be null/,
    );
  } finally {
    connection.disconnect();
  }
});
