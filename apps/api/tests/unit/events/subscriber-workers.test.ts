/**
 * 訂閱者佇列的 Worker（change outbox-event-delivery：event-delivery「每個訂閱者各自處理」）。
 *
 * Worker 換成記錄 processor 的假實作；BullMQ 重試一個 job 時，只會再呼叫那個佇列的 processor。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const createdWorkers = vi.hoisted(() => [] as Array<{ queue: string; opts: Record<string, unknown> }>);
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Worker: class {
    constructor(queue: string, _processor: unknown, opts: Record<string, unknown>) {
      createdWorkers.push({ queue, opts });
    }
    on() {
      return this;
    }
    async close() {}
  },
}));

import {
  claimSideEffect,
  EVENT_AUTOMATION_QUEUE,
  EVENT_NOTIFICATION_QUEUE,
  EVENT_WEBHOOK_QUEUE,
  USAGE_ALERT_EMAIL_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
  type EventJobData,
} from '@open333crm/core';
import { bullWorkerFactory, createEventRouter, startQueueWorkers, subscriberProcessor } from '#src/events/subscriber-workers.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const job = (data: EventJobData) => ({ id: data.eventId, data });

function fakeWorkers() {
  const processors = new Map<string, (job: unknown) => Promise<unknown>>();
  const createWorker = (queue: string, processor: (job: unknown) => Promise<unknown>) => {
    processors.set(queue, processor);
    return { close: async () => {} };
  };
  return { processors, createWorker };
}

test('webhook 失敗重試：自動化訂閱者不再處理同一個事件', async () => {
  const handled: string[] = [];
  const automation = createEventRouter();
  automation.on('case.created', async (event) => void handled.push(`automation:${event.id}`));
  const webhook = async () => {
    throw new Error('HTTP 500');
  };
  const { processors, createWorker } = fakeWorkers();
  startQueueWorkers(
    { [EVENT_AUTOMATION_QUEUE]: subscriberProcessor(automation.handle), [EVENT_WEBHOOK_QUEUE]: subscriberProcessor(webhook) },
    createWorker,
  );

  const data: EventJobData = { eventId: 'e1', name: 'case.created', tenantId: TENANT, timestamp: new Date().toISOString(), payload: {} };
  await processors.get(EVENT_AUTOMATION_QUEUE)!(job(data));
  // webhook 的 processor 丟錯讓 BullMQ 重試；重試只呼叫 webhook 的 processor
  await assert.rejects(processors.get(EVENT_WEBHOOK_QUEUE)!(job(data)), /HTTP 500/);
  await assert.rejects(processors.get(EVENT_WEBHOOK_QUEUE)!(job(data)), /HTTP 500/);

  assert.deepEqual(handled, ['automation:e1']);
});

test('處理程式收到的 timestamp 是 Date，事件 id 是 job 的事件 id', async () => {
  const received: Array<{ id: string; timestamp: unknown }> = [];
  const router = createEventRouter();
  router.on('case.created', async (event) => void received.push({ id: event.id, timestamp: event.timestamp }));
  const iso = '2026-10-21T00:00:00.000Z';
  await subscriberProcessor(router.handle)(
    job({ eventId: 'e2', name: 'case.created', tenantId: TENANT, timestamp: iso, payload: {} }) as never,
  );
  assert.equal(received[0].id, 'e2');
  assert.ok(received[0].timestamp instanceof Date);
  assert.equal((received[0].timestamp as Date).toISOString(), iso);
});

test('沒有處理程式的事件名稱：不丟錯', async () => {
  const router = createEventRouter();
  await subscriberProcessor(router.handle)(
    job({ eventId: 'e3', name: 'case.closed', tenantId: TENANT, timestamp: new Date().toISOString(), payload: {} }) as never,
  );
});

test('Slow event does not block other events：每個 Worker 同時處理多個 job', () => {
  createdWorkers.length = 0;
  const createWorker = bullWorkerFactory('redis://localhost:6379', {
    [WEBHOOK_DELIVERY_QUEUE]: { settings: { backoffStrategy: () => 1_000 } },
  });
  const noop = async () => {};
  for (const queue of [EVENT_AUTOMATION_QUEUE, EVENT_NOTIFICATION_QUEUE, EVENT_WEBHOOK_QUEUE, USAGE_ALERT_EMAIL_QUEUE, WEBHOOK_DELIVERY_QUEUE]) {
    createWorker(queue, noop);
  }
  const concurrency = Object.fromEntries(createdWorkers.map((w) => [w.queue, w.opts.concurrency]));
  assert.deepEqual(concurrency, {
    [EVENT_AUTOMATION_QUEUE]: 10,
    [EVENT_NOTIFICATION_QUEUE]: 5,
    [EVENT_WEBHOOK_QUEUE]: 5,
    [USAGE_ALERT_EMAIL_QUEUE]: 5,
    [WEBHOOK_DELIVERY_QUEUE]: 10,
  });
  // 個別佇列的設定仍然生效
  assert.ok(createdWorkers.find((w) => w.queue === WEBHOOK_DELIVERY_QUEUE)!.opts.settings);
});

// 被認領擋下的副作用（change queue-monitoring：queue-monitoring「被認領擋下的副作用標示跳過」）
function claimingHandler(createCount: 0 | 1) {
  const tx = { sideEffectClaim: { createMany: async () => ({ count: createCount }) } } as never;
  return async (event: { id: string; tenantId: string }) => {
    await claimSideEffect(tx, { tenantId: event.tenantId, kind: 'automation_action', sourceId: event.id, subKey: 'rule-a#0' });
  };
}

const automationData: EventJobData = { eventId: 'e1', name: 'case.created', tenantId: TENANT, timestamp: new Date().toISOString(), payload: {} };

test('重送已執行過規則動作的 job：subscriberProcessor 的回傳值列出被跳過的認領鍵', async () => {
  const result = await subscriberProcessor(claimingHandler(0))(job(automationData) as never);

  assert.deepEqual(result, { skippedClaims: [{ kind: 'automation_action', sourceId: 'e1', subKey: 'rule-a#0' }] });
});

test('第一次執行沒有跳過：subscriberProcessor 回傳 undefined', async () => {
  const result = await subscriberProcessor(claimingHandler(1))(job(automationData) as never);

  assert.equal(result, undefined);
});
