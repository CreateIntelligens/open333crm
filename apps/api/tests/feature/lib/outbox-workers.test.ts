/**
 * workers 寫入的事件在 API 沒有執行時不遺失（change outbox-event-delivery：event-delivery
 * 「workers 的事件與資料一起 commit」的 Scenario「API 行程沒有在執行」）。
 *
 * 以真實 PostgreSQL 與 Redis 模擬：workers 以 admin 連線在交易內寫 outbox，這時沒有訂閱者 Worker；
 * 之後才建立 Worker（API 啟動）。訂閱者佇列換成以 MARK 為前綴的測試佇列。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { dispatchOutboxRows, EVENT_AUTOMATION_QUEUE, writeOutbox, type EventJobData } from '@open333crm/core';
import { runOutboxRelay } from '#src/modules/outbox/outbox.scheduler.js';

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const REDIS_URL = process.env.REDIS_URL;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
if (!ADMIN_URL || !REDIS_URL) {
  throw new Error('outbox-workers 需要 DATABASE_URL_ADMIN / REDIS_URL，由 tests/setup/feature.env.ts 提供');
}

const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `outbox-workers-${randomUUID()}`;
const connection = { url: REDIS_URL };
const queues = new Map<string, Queue>();
const getQueue = (name: string) => {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(`${MARK}-${name}`, { connection });
    queues.set(name, q);
  }
  return q;
};

afterAll(async () => {
  await adminDb.outbox.deleteMany({ where: { payload: { path: ['mark'], equals: MARK } } });
  for (const q of queues.values()) {
    await q.obliterate({ force: true });
    await q.close();
  }
  await adminDb.$disconnect();
});

/** workers 的 add_tag：以 admin 連線在交易內寫 outbox，帶租戶 ID */
async function workersAddTag(contactId: string) {
  return adminDb.$transaction((tx) =>
    writeOutbox(tx, { tenantId: TENANT_A, kind: 'event', name: 'contact.tagged', payload: { contactId, source: 'agent', mark: MARK } }),
  );
}

async function processWithNewWorker(): Promise<EventJobData> {
  const received = new Promise<EventJobData>((resolve) => {
    const worker = new Worker(
      getQueue(EVENT_AUTOMATION_QUEUE).name,
      async (job) => {
        resolve(job.data as EventJobData);
        void worker.close();
      },
      { connection },
    );
  });
  return received;
}

test('API 行程沒有在執行：事件留在佇列，API 啟動之後訂閱者收到', async () => {
  const contactId = randomUUID();
  const row = await workersAddTag(contactId);
  // 快路徑照常送進佇列，但這時沒有訂閱者 Worker
  await dispatchOutboxRows(adminDb, [row], getQueue);

  const data = await processWithNewWorker();
  assert.equal(data.eventId, row.id);
  assert.equal(data.payload.contactId, contactId);
});

test('API 行程沒有在執行、快路徑也失敗：API 啟動後由補送排程送出', async () => {
  const contactId = randomUUID();
  const row = await workersAddTag(contactId);
  await dispatchOutboxRows(adminDb, [row], () => {
    throw new Error('Redis 無法連線');
  });
  assert.equal((await adminDb.outbox.findUnique({ where: { id: row.id } }))?.dispatchedAt, null);

  // API 啟動：超過寬限時間的資料列由 outbox-relay 補送
  await adminDb.outbox.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });
  await runOutboxRelay(adminDb, new Date(), (name) => getQueue(name));
  const data = await processWithNewWorker();
  assert.equal(data.eventId, row.id);
  assert.equal(data.payload.contactId, contactId);
});
