/**
 * outbox 資料列送進佇列（change outbox-event-delivery：event-delivery「commit 之後立即送給訂閱者」）。
 *
 * 佇列與資料庫都用假的實作：佇列記錄 add() 的參數，資料庫記錄標記已送出的 id。
 * BullMQ 以 job id 去重的行為見 apps/api/tests/feature/lib/outbox-dedupe.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  dispatchOutboxRows,
  writeOutbox,
  EVENT_AUTOMATION_QUEUE,
  EVENT_NOTIFICATION_QUEUE,
  EVENT_WEBHOOK_QUEUE,
  type OutboxRow,
} from '#src/outbox/index.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const CREATED_AT = new Date('2026-10-21T00:00:00.000Z');

type Added = { queue: string; name: string; data: unknown; opts: Record<string, unknown> };

function fakes(options: { failQueue?: string; returnedId?: (opts: Record<string, unknown>) => unknown } = {}) {
  const added: Added[] = [];
  const marked: string[] = [];
  const getQueue = (queue: string) => ({
    async add(name: string, data: unknown, opts: Record<string, unknown>) {
      if (queue === options.failQueue) throw new Error(`queue ${queue} down`);
      added.push({ queue, name, data, opts });
      // BullMQ 回傳建立的（或 id 相同、已存在的）job
      const id = options.returnedId ? options.returnedId(opts) : opts.jobId;
      return id === undefined ? undefined : { id };
    },
  });
  const db = {
    outbox: {
      async updateMany(args: { where: { id: { in: string[] }; dispatchedAt: null } }) {
        assert.equal(args.where.dispatchedAt, null, '只標記還沒標記的資料列');
        marked.push(...args.where.id.in);
        return { count: args.where.id.in.length };
      },
    },
  };
  return { added, marked, getQueue, db };
}

function eventRow(id: string, name: string): OutboxRow {
  return { id, tenantId: TENANT, kind: 'event', name, queueName: null, payload: { conversationId: 'c1' }, jobOptions: null, createdAt: CREATED_AT };
}

test('一般情況：message.received 送進三個訂閱者佇列，job id 是事件 id，並標記已送出', async () => {
  const { added, marked, getQueue, db } = fakes();
  await dispatchOutboxRows(db as never, [eventRow('e1', 'message.received')], getQueue as never);

  assert.deepEqual(added.map((a) => a.queue).sort(), [EVENT_AUTOMATION_QUEUE, EVENT_NOTIFICATION_QUEUE, EVENT_WEBHOOK_QUEUE].sort());
  for (const job of added) {
    assert.equal(job.opts.jobId, 'e1');
    assert.equal(job.name, 'message.received');
    assert.deepEqual(job.data, {
      eventId: 'e1',
      name: 'message.received',
      tenantId: TENANT,
      timestamp: CREATED_AT.toISOString(),
      payload: { conversationId: 'c1' },
    });
  }
  assert.deepEqual(marked, ['e1']);
});

test('只送給訂閱了這個事件的訂閱者：case.resolved 只進 webhook 佇列', async () => {
  const { added, getQueue, db } = fakes();
  await dispatchOutboxRows(db as never, [eventRow('e2', 'case.resolved')], getQueue as never);
  assert.deepEqual(added.map((a) => a.queue), [EVENT_WEBHOOK_QUEUE]);
});

test('建立 job 失敗：該事件維持未送出，其他事件照常標記，不丟錯', async () => {
  const { marked, getQueue, db } = fakes({ failQueue: EVENT_AUTOMATION_QUEUE });
  await dispatchOutboxRows(db as never, [eventRow('e3', 'message.received'), eventRow('e4', 'case.resolved')], getQueue as never);
  assert.deepEqual(marked, ['e4']);
});

test("kind = 'job'：送到 queueName，帶原本的選項，job id 是 outbox id", async () => {
  const { added, marked, getQueue, db } = fakes();
  const row: OutboxRow = {
    id: 'j1',
    tenantId: TENANT,
    kind: 'job',
    name: 'rich-menu:bind',
    queueName: 'rich-menu-bind',
    payload: { contactId: 'x' },
    jobOptions: { attempts: 2, jobId: 'ignored' },
    createdAt: CREATED_AT,
  };
  await dispatchOutboxRows(db as never, [row], getQueue as never);
  assert.deepEqual(added, [
    { queue: 'rich-menu-bind', name: 'rich-menu:bind', data: { contactId: 'x' }, opts: { attempts: 2, jobId: 'j1' } },
  ]);
  assert.deepEqual(marked, ['j1']);
});

test('job 選項只接受白名單：其他選項寫入 outbox 時丟錯，交易 rollback', async () => {
  const tx = { outbox: { create: async () => assert.fail('不應寫入') } };
  for (const opts of [{ deduplication: { id: 'shared' } }, { debounce: { id: 'shared' } }, { repeat: { every: 60_000, limit: 0 } }, { jobId: 'mine' }, { lifo: true }]) {
    await assert.rejects(
      writeOutbox(tx as never, { tenantId: TENANT, kind: 'job', name: 'x', queueName: 'q', payload: {}, jobOptions: opts as never }),
      new RegExp(Object.keys(opts)[0]),
    );
  }
});

test('白名單內的選項照常寫入', async () => {
  const created: unknown[] = [];
  const tx = { outbox: { create: async (args: unknown) => (created.push(args), { id: 'j1' }) } };
  const jobOptions = { attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, delay: 5_000, priority: 1, removeOnComplete: true, removeOnFail: 100 };
  await writeOutbox(tx as never, { tenantId: TENANT, kind: 'job', name: 'x', queueName: 'q', payload: {}, jobOptions });
  assert.equal(created.length, 1);
});

test('佇列沒有建立 id 等於 outbox id 的 job：該列維持未送出', async () => {
  for (const returnedId of [() => undefined, () => 'repeat:abc']) {
    const { marked, getQueue, db } = fakes({ returnedId });
    await dispatchOutboxRows(db as never, [eventRow('e1', 'case.resolved')], getQueue);
    assert.deepEqual(marked, []);
  }
});

test('job 選項以序列化後的內容檢查：toJSON 回傳白名單外的選項時丟錯', async () => {
  const tx = { outbox: { create: async () => assert.fail('不應寫入') } };
  class Options {
    attempts = 3;
    toJSON() {
      return { repeat: { every: 60_000, limit: 0 } };
    }
  }
  await assert.rejects(
    writeOutbox(tx as never, { tenantId: TENANT, kind: 'job', name: 'x', queueName: 'q', payload: {}, jobOptions: new Options() as never }),
    /repeat/,
  );
});
