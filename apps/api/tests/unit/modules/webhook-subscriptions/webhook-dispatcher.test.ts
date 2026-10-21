/**
 * 對外 webhook 的轉送與重試（change outbox-event-delivery：webhook-subscription-egress
 * 「只轉送對外事件清單內的事件」「送出的內容帶事件 id」「每個訂閱網址各自重試」「測試送出只送一次」）。
 *
 * event-webhook 的處理程式為每個訂閱建立一個 webhook-delivery job；佇列換成記錄 add() 的假實作。
 * webhook-delivery 的 processor 每次只送一次 HTTP，失敗時丟錯讓 BullMQ 重試，這裡直接呼叫它模擬重試。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const queued = vi.hoisted(() => [] as Array<{ queue: string; name: string; data: Record<string, unknown>; opts?: Record<string, unknown> }>);
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    constructor(private readonly queueName: string) {}
    async add(name: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
      queued.push({ queue: this.queueName, name, data, opts });
    }
  },
}));
vi.mock('#src/modules/webhook/downstream-forwarder.js', () => ({ isBlockedUrl: async () => false }));

import { EVENT_WEBHOOK_QUEUE, subscriberQueuesOf, WEBHOOK_DELIVERY_QUEUE } from '@open333crm/core';
import {
  dispatchWebhook,
  processWebhookDelivery,
  setupWebhookDispatcher,
  WEBHOOK_RETRY_DELAYS_MS,
  webhookRetryDelay,
  type WebhookDeliveryJob,
} from '#src/modules/webhook-subscriptions/webhook-dispatcher.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const EVENT = '33333333-3333-4333-8333-333333333333';

type Sub = { id: string; tenantId: string; url: string; secret: string; isActive: boolean; events: string[] };
type Delivery = { id: string; subscriptionId: string; eventId: string | null; attempts: number; success: boolean; statusCode: number | null };

function fakeDb(subs: Sub[]) {
  const deliveries: Delivery[] = [];
  const db = {
    webhookSubscription: {
      findMany: async ({ where }: { where: { tenantId: string; events: { has: string } } }) =>
        subs.filter((s) => s.tenantId === where.tenantId && s.isActive && s.events.includes(where.events.has)),
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        subs.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null,
    },
    webhookDelivery: {
      createManyAndReturn: async ({ data }: { data: Array<Omit<Delivery, 'id' | 'success' | 'statusCode'>> }) => {
        const row = data[0];
        if (deliveries.some((d) => d.subscriptionId === row.subscriptionId && d.eventId === row.eventId)) return [];
        const d = { ...row, id: `delivery-${deliveries.length + 1}`, success: false, statusCode: null };
        deliveries.push(d);
        return [d];
      },
      create: async ({ data }: { data: Omit<Delivery, 'id' | 'success' | 'statusCode'> }) => {
        const d = { ...data, id: `delivery-${deliveries.length + 1}`, success: false, statusCode: null };
        deliveries.push(d);
        return d;
      },
      findFirst: async ({ where }: { where: { subscriptionId: string; eventId: string } }) =>
        deliveries.find((d) => d.subscriptionId === where.subscriptionId && d.eventId === where.eventId) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const d = deliveries.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          (d as Record<string, unknown>)[k] =
            v && typeof v === 'object' && 'increment' in v ? (d as never as Record<string, number>)[k] + (v as { increment: number }).increment : v;
        }
        return d;
      },
    },
  };
  return { db, deliveries };
}

const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
/** 依網址決定回應狀態碼 */
let statusOf: (url: string) => number = () => 200;

beforeEach(() => {
  queued.length = 0;
  requests.length = 0;
  statusOf = () => 200;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response('', { status: statusOf(url) });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sub(id: string, url: string, events: string[]): Sub {
  return { id, tenantId: TENANT, url, secret: 's', isActive: true, events };
}

function event(name: string) {
  return { id: EVENT, name: name as never, tenantId: TENANT, timestamp: new Date('2026-10-21T00:00:00.000Z'), payload: { caseId: 'c1' } };
}

function deliveryJobs() {
  return queued.filter((q) => q.queue === WEBHOOK_DELIVERY_QUEUE);
}

async function runDelivery(db: unknown, data: Record<string, unknown>) {
  return processWebhookDelivery(db as never)({ data: data as unknown as WebhookDeliveryJob } as never);
}

test('清單內的事件：訂閱 case.created 的網址收到這個事件', async () => {
  const { db } = fakeDb([sub('sub-1', 'https://93.184.216.34/a', ['case.created'])]);
  await setupWebhookDispatcher(db as never)(event('case.created'));
  const jobs = deliveryJobs();
  assert.deepEqual(jobs.map((j) => j.opts?.jobId), [`${EVENT}__sub-1`]);
  await runDelivery(db, jobs[0].data);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.event, 'case.created');
});

test('不在清單內的名稱：事件不進 webhook 佇列，處理程式也不轉送', async () => {
  assert.equal(subscriberQueuesOf('internal.test').includes(EVENT_WEBHOOK_QUEUE), false);
  const { db } = fakeDb([sub('sub-1', 'https://93.184.216.34/a', ['internal.test'])]);
  await setupWebhookDispatcher(db as never)(event('internal.test'));
  assert.deepEqual(deliveryJobs(), []);
});

test('同一個事件送出兩次：id 與 X-Webhook-Delivery 相同，送出紀錄只有一筆，attempts 是 2', async () => {
  const { db, deliveries } = fakeDb([sub('sub-1', 'https://93.184.216.34/a', ['case.created'])]);
  await setupWebhookDispatcher(db as never)(event('case.created'));
  const [job] = deliveryJobs();
  statusOf = () => 500;
  await assert.rejects(runDelivery(db, job.data));
  statusOf = () => 200;
  await runDelivery(db, job.data);

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((r) => r.body.id), [EVENT, EVENT]);
  assert.deepEqual(requests.map((r) => r.headers['X-Webhook-Event-Id']), [EVENT, EVENT]);
  assert.equal(requests[0].headers['X-Webhook-Delivery'], requests[1].headers['X-Webhook-Delivery']);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].attempts, 2);
  assert.equal(deliveries[0].success, true);
});

test('一個網址失敗：只重試 U1，U2 只收到一次', async () => {
  const U1 = 'https://93.184.216.34/u1';
  const U2 = 'https://93.184.216.34/u2';
  const { db } = fakeDb([sub('sub-1', U1, ['case.created']), sub('sub-2', U2, ['case.created'])]);
  await setupWebhookDispatcher(db as never)(event('case.created'));
  const [j1, j2] = deliveryJobs();
  statusOf = (url) => (url === U1 ? 500 : 200);

  await assert.rejects(runDelivery(db, j1.data), /HTTP 500/);
  await runDelivery(db, j2.data);
  // BullMQ 只重試失敗的 job
  await assert.rejects(runDelivery(db, j1.data), /HTTP 500/);

  assert.equal(requests.filter((r) => r.url === U2).length, 1);
  assert.equal(requests.filter((r) => r.url === U1).length, 2);
});

test('每個網址最多送出 3 次，間隔 1 秒與 5 秒', () => {
  assert.equal(WEBHOOK_RETRY_DELAYS_MS.length + 1, 3);
  assert.deepEqual([webhookRetryDelay(1), webhookRetryDelay(2)], [1_000, 5_000]);
});

test('測試網址回傳 500：只送一次，結果是失敗與 500，送出紀錄 attempts 1，帶新產生的事件 id', async () => {
  statusOf = () => 500;
  const { db, deliveries } = fakeDb([]);
  const testId = '44444444-4444-4444-8444-444444444444';
  const result = await dispatchWebhook(db as never, 'sub-1', 'https://93.184.216.34/t', 's', 'webhook.test', { id: testId, event: 'webhook.test' });
  assert.equal(result.success, false);
  assert.equal(result.statusCode, 500);
  assert.equal(requests.length, 1);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].attempts, 1);
  assert.equal(deliveries[0].eventId, testId);
  assert.equal(requests[0].headers['X-Webhook-Event-Id'], testId);
});
