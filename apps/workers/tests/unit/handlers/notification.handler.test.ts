import assert from 'node:assert/strict';
import { afterEach, describe, test, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { logger } from '@open333crm/core';
import { handleNotificationJob } from '#src/handlers/notification.handler';

/**
 * notification:dispatch 的處理函式（standalone-worker-runtime「Notification Job Handling」）。
 * 寫入通知是 job 的成敗；推播是最多一次、可以遺失的副作用，失敗只記 log。
 */

const jobData = {
  tenantId: 't1',
  agentId: 'a1',
  type: 'case.assigned',
  title: '新案件',
  body: '案件已指派給你',
};

const job = { id: 'n1', name: 'notification:dispatch', data: jobData } as unknown as Job;

function makePrisma(create: (args: { data: Record<string, unknown> }) => Promise<unknown>) {
  return { notification: { create } } as unknown as PrismaClient;
}

function makeRedis(publish: (channel: string, message: string) => Promise<number>) {
  return { publish } as unknown as IORedis;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleNotificationJob', () => {
  test('Database write succeeds but Redis publish fails', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const prisma = makePrisma(async ({ data }) => ({ id: 'notif-1', ...data }));
    const redis = makeRedis(async () => {
      throw new Error('Redis down');
    });

    await assert.doesNotReject(handleNotificationJob(job, prisma, redis));

    assert.equal(errorLog.mock.calls.length, 1);
    assert.match(String(errorLog.mock.calls[0][0]), /notif-1/);
  });

  test('Notification job consumed by worker', async () => {
    const created: Record<string, unknown>[] = [];
    const published: { channel: string; message: string }[] = [];
    const prisma = makePrisma(async ({ data }) => {
      created.push(data);
      return { id: 'notif-1', ...data };
    });
    const redis = makeRedis(async (channel, message) => {
      published.push({ channel, message });
      return 1;
    });

    await handleNotificationJob(job, prisma, redis);

    assert.equal(created.length, 1);
    assert.equal(created[0].agentId, 'a1');
    assert.equal(published.length, 1);
    const payload = JSON.parse(published[0].message);
    assert.equal(payload.room, 'agent:a1');
    assert.equal(payload.event, 'notification.new');
    assert.equal(payload.data.id, 'notif-1');
  });

  test('Database write fails', async () => {
    let publishCalls = 0;
    const prisma = makePrisma(async () => {
      throw new Error('DB down');
    });
    const redis = makeRedis(async () => {
      publishCalls++;
      return 1;
    });

    await assert.rejects(handleNotificationJob(job, prisma, redis), /DB down/);
    assert.equal(publishCalls, 0);
  });

  test('Worker stops after the record is written', async () => {
    // BullMQ 重新執行同一個 job：處理函式不去重，客服人員收到兩則相同的通知
    const created: Record<string, unknown>[] = [];
    let seq = 0;
    const prisma = makePrisma(async ({ data }) => {
      created.push(data);
      seq++;
      return { id: `notif-${seq}`, ...data };
    });
    const redis = makeRedis(async () => 1);

    await handleNotificationJob(job, prisma, redis);
    await handleNotificationJob(job, prisma, redis);

    assert.equal(created.length, 2);
    assert.deepEqual(created[0], created[1]);
  });
});
