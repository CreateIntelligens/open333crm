/**
 * outbox-relay 排程（change outbox-event-delivery：event-delivery「補送未送出的事件」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EVENT_WEBHOOK_QUEUE } from '@open333crm/core';
import { runOutboxRelay } from '#src/modules/outbox/outbox.scheduler.js';
import { fakeOutboxDb, type FakeRow } from './fake-outbox-db.js';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const TENANT = 'a0000000-0000-0000-0000-000000000001';

function row(id: string, ageMs: number): FakeRow {
  return {
    id,
    tenantId: TENANT,
    kind: 'event',
    name: 'case.resolved',
    queueName: null,
    payload: {},
    jobOptions: null,
    createdAt: new Date(NOW.getTime() - ageMs),
    dispatchedAt: null,
  };
}

function fakeQueues() {
  const added: Array<{ queue: string; jobId: unknown }> = [];
  const getQueue = (queue: string) => ({
    async add(_name: string, _data: unknown, opts: { jobId?: string }) {
      added.push({ queue, jobId: opts.jobId });
      return { id: opts.jobId };
    },
  });
  return { added, getQueue };
}

test('行程在送出前結束：補送建立 3 分鐘、未送出的事件，並標記已送出', async () => {
  const rows = [row('e1', 3 * 60_000)];
  const { added, getQueue } = fakeQueues();
  await runOutboxRelay(fakeOutboxDb(rows) as never, NOW, getQueue);
  assert.deepEqual(added, [{ queue: EVENT_WEBHOOK_QUEUE, jobId: 'e1' }]);
  assert.ok(rows[0].dispatchedAt instanceof Date);
});

test('寬限時間內不補送：建立 30 秒的事件不送出', async () => {
  const rows = [row('e2', 30_000)];
  const { added, getQueue } = fakeQueues();
  await runOutboxRelay(fakeOutboxDb(rows) as never, NOW, getQueue);
  assert.deepEqual(added, []);
  assert.equal(rows[0].dispatchedAt, null);
});

test('已標記送出的事件不再送出', async () => {
  const rows = [{ ...row('e3', 5 * 60_000), dispatchedAt: new Date(NOW.getTime() - 60_000) }];
  const { added, getQueue } = fakeQueues();
  await runOutboxRelay(fakeOutboxDb(rows) as never, NOW, getQueue);
  assert.deepEqual(added, []);
});
