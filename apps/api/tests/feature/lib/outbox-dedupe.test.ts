/**
 * BullMQ 以 job id 擋住同一個事件的重複送出（change outbox-event-delivery：
 * event-delivery「同一個事件不重複建立 job」）。
 *
 * 用真實 Redis。訂閱者佇列換成以 MARK 為前綴的測試佇列，避免碰到其他測試。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { dispatchOutboxRows, EVENT_WEBHOOK_QUEUE, type OutboxRow } from '@open333crm/core';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error('outbox-dedupe 需要 REDIS_URL，由 tests/setup/feature.env.ts 提供');

const MARK = `outbox-dedupe-${randomUUID()}`;
const connection = { url: REDIS_URL };
const queue = new Queue(`${MARK}-${EVENT_WEBHOOK_QUEUE}`, { connection });
const getQueue = (name: string) => {
  assert.equal(name, EVENT_WEBHOOK_QUEUE, 'case.resolved 只有 webhook 訂閱');
  return queue;
};
/** 標記已送出的假資料庫：這裡只測佇列 */
const db = { outbox: { updateMany: async () => ({ count: 1 }) } };

const processed: string[] = [];
const worker = new Worker(
  queue.name,
  async (job) => {
    processed.push(job.id!);
  },
  { connection },
);
const queueEvents = new QueueEvents(queue.name, { connection });

afterAll(async () => {
  await worker.close();
  await queueEvents.close();
  await queue.obliterate({ force: true });
  await queue.close();
});

function row(id: string): OutboxRow {
  return {
    id,
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    kind: 'event',
    name: 'case.resolved',
    queueName: null,
    payload: {},
    jobOptions: null,
    createdAt: new Date(),
  };
}

async function waitCompleted(jobId: string) {
  const job = await queue.getJob(jobId);
  assert.ok(job);
  await job.waitUntilFinished(queueEvents, 10_000);
}

test('快路徑與補送同時送出：佇列只有一個 job，訂閱者只處理一次', async () => {
  const id = randomUUID();
  await Promise.all([dispatchOutboxRows(db as never, [row(id)], getQueue), dispatchOutboxRows(db as never, [row(id)], getQueue)]);
  await waitCompleted(id);
  // 再等一下，確認沒有第二個 job 被處理
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(processed.filter((p) => p === id), [id]);
});

test('job 已完成之後再送一次：不新增 job，訂閱者不再處理', async () => {
  const id = randomUUID();
  await dispatchOutboxRows(db as never, [row(id)], getQueue);
  await waitCompleted(id);
  // 完成的 job 保留 24 小時（SUBSCRIBER_JOB_OPTIONS）；這段時間內以同一個 id 再送一次
  await dispatchOutboxRows(db as never, [row(id)], getQueue);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(processed.filter((p) => p === id), [id]);
  assert.equal((await queue.getJob(id))?.finishedOn !== undefined, true);
});
