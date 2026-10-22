/**
 * ctx.publish、ctx.enqueue 對真實 PostgreSQL 的行為（change outbox-event-delivery：
 * event-delivery「事件與資料一起 commit」、tenant-transaction-context「事件與佇列 job 至少送出一次」）。
 *
 * 快路徑換成不做事的實作，模擬行程在 commit 之後、送出之前結束；之後直接呼叫補送排程。
 * 測試資料以 MARK 標記，afterAll 用 admin 連線刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { closeOutboxQueues, EVENT_WEBHOOK_QUEUE, getOutboxQueue, writeOutbox } from '@open333crm/core';
import { inTenant, type EventPublisher } from '#src/lib/tenant-ctx.js';
import { runOutboxRelay } from '#src/modules/outbox/outbox.scheduler.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const REDIS_URL = process.env.REDIS_URL;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';

if (!TENANT_URL || !ADMIN_URL || !REDIS_URL) {
  throw new Error('outbox 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN / REDIS_URL，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `outbox-${randomUUID()}`;
const QUEUE = `${MARK}-queue`;
const queue = new Queue(QUEUE, { connection: { url: REDIS_URL } });

/** 寫 outbox，但快路徑不做事：模擬行程在送出之前結束 */
let writes = 0;
const noFastPath: EventPublisher = {
  write: (tx, input) => {
    writes++;
    return writeOutbox(tx, input);
  },
  dispatch: async () => {},
};
const deps = { prisma: tenantDb, events: noFastPath };

afterAll(async () => {
  await adminDb.outbox.deleteMany({ where: { OR: [{ queueName: QUEUE }, { payload: { path: ['mark'], equals: MARK } }] } });
  await adminDb.contact.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await queue.obliterate({ force: true });
  await queue.close();
  await closeOutboxQueues();
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

test('commit 之後 outbox 有這個事件，而且尚未標記已送出', async () => {
  const contactId = await inTenant(deps, TENANT_A, async (ctx) => {
    const contact = await ctx.tx.contact.create({ data: { tenantId: ctx.tenantId, displayName: `${MARK}-commit` } });
    await ctx.publish('contact.created', { contactId: contact.id, mark: MARK });
    return contact.id;
  });
  const rows = await adminDb.outbox.findMany({ where: { payload: { path: ['contactId'], equals: contactId } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, TENANT_A);
  assert.equal(rows[0].name, 'contact.created');
  assert.equal(rows[0].dispatchedAt, null);
});

test('rollback 時 outbox 沒有這個事件', async () => {
  const marker = randomUUID();
  await assert.rejects(
    inTenant(deps, TENANT_A, async (ctx) => {
      await ctx.publish('contact.created', { marker, mark: MARK });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(await adminDb.outbox.count({ where: { payload: { path: ['marker'], equals: marker } } }), 0);
});

test('行程在送出 job 之前結束：補送排程把 job 送進佇列，job id 等於 outbox id', async () => {
  await inTenant(deps, TENANT_A, (ctx) => ctx.enqueue(QUEUE, 'job-j', { mark: MARK }, { attempts: 2 }));
  const [row] = await adminDb.outbox.findMany({ where: { queueName: QUEUE } });
  assert.equal(row.dispatchedAt, null);
  // 超過寬限時間，補送排程才會處理
  await adminDb.outbox.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });

  await runOutboxRelay(adminDb, new Date(), (name) => (name === QUEUE ? queue : { add: async () => ({}) }));

  const job = await queue.getJob(row.id);
  assert.ok(job, '佇列要有 id 等於 outbox id 的 job');
  assert.equal(job.name, 'job-j');
  assert.deepEqual(job.data, { mark: MARK });
  assert.equal(job.opts.attempts, 2);
  const after = await adminDb.outbox.findUnique({ where: { id: row.id } });
  assert.ok(after?.dispatchedAt instanceof Date);
});

test('行程在推播之前結束：推播不寫進 outbox，所以不會補送', async () => {
  const before = writes;
  const io = { to: () => ({ emit: () => {} }) };
  await inTenant({ ...deps, io: io as never }, TENANT_A, async (ctx) => {
    ctx.notify('case.updated', { mark: MARK });
  });
  assert.equal(writes, before);
});

test('快路徑以綁定租戶的交易標記已送出（不需要 admin 連線）', async () => {
  const { createOutboxPublisher } = await import('#src/events/outbox-publisher.js');
  const marker = randomUUID();
  const fastPath = createOutboxPublisher(tenantDb);
  // 事件送到 webhook 佇列；這裡不檢查佇列，只看標記
  await inTenant({ prisma: tenantDb, events: fastPath }, TENANT_A, (ctx) =>
    ctx.publish('case.resolved', { marker, mark: MARK }),
  );
  let row = null;
  for (let i = 0; i < 50 && !row?.dispatchedAt; i++) {
    await new Promise((r) => setTimeout(r, 100));
    row = await adminDb.outbox.findFirst({ where: { payload: { path: ['marker'], equals: marker } } });
  }
  assert.ok(row?.dispatchedAt instanceof Date, '快路徑送出後要標記已送出');
  await (getOutboxQueue(EVENT_WEBHOOK_QUEUE) as Queue).remove(row.id);
});
