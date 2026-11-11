/**
 * eventBus 轉送舊寫法的事件（change outbox-event-delivery：event-delivery「舊寫法的事件也送給訂閱者」）。
 *
 * 佇列換成記錄 add() 的假實作；舊寫法的事件不寫 outbox，所以這裡沒有資料庫。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const added = vi.hoisted(() => [] as Array<{ queue: string; name: string; data: Record<string, unknown>; opts: Record<string, unknown> }>);
vi.mock('@open333crm/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@open333crm/core')>();
  return {
    ...original,
    getOutboxQueue: (queue: string) => ({
      async add(name: string, data: Record<string, unknown>, opts: Record<string, unknown>) {
        added.push({ queue, name, data, opts });
        return {};
      },
    }),
  };
});

const { eventBus } = await import('#src/events/event-bus.js');
const { EVENT_AUTOMATION_QUEUE, EVENT_WEBHOOK_QUEUE } = await import('@open333crm/core');

const TENANT = 'a0000000-0000-0000-0000-000000000001';

beforeEach(() => {
  added.length = 0;
});

test('舊寫法發出事件：每個訂閱者佇列各一個 job，job 帶同一個事件 id', async () => {
  const timestamp = new Date('2026-10-21T00:00:00.000Z');
  eventBus.publish({ name: 'case.created', tenantId: TENANT, timestamp, payload: { caseId: 'c1' } });
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(added.map((a) => a.queue).sort(), [EVENT_AUTOMATION_QUEUE, EVENT_WEBHOOK_QUEUE].sort());
  const eventId = added[0].data.eventId;
  assert.match(String(eventId), /^[0-9a-f-]{36}$/);
  for (const job of added) {
    assert.equal(job.name, 'case.created');
    assert.equal(job.opts.jobId, eventId);
    assert.deepEqual(job.data, {
      eventId,
      name: 'case.created',
      tenantId: TENANT,
      timestamp: timestamp.toISOString(),
      payload: { caseId: 'c1' },
    });
  }
});

test('每次發出產生新的事件 id', async () => {
  eventBus.publish({ name: 'case.resolved', tenantId: TENANT, timestamp: new Date(), payload: {} });
  eventBus.publish({ name: 'case.resolved', tenantId: TENANT, timestamp: new Date(), payload: {} });
  await new Promise((r) => setImmediate(r));
  const ids = added.map((a) => a.data.eventId);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});
