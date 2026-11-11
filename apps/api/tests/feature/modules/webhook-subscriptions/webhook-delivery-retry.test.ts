/**
 * webhook-delivery 的重試在 API 重新啟動之後繼續（change outbox-event-delivery：
 * webhook-subscription-egress「每個訂閱網址各自重試」的 Scenario「重試期間 API 重新啟動」）。
 *
 * 用真實 Redis 與 PostgreSQL。關閉第一個 Worker 模擬 API 結束，再建立新的 Worker 模擬 API 啟動。
 * 訂閱網址的 HTTP 換成假的 fetch：第一次回 500，之後回 200。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import {
  processWebhookDelivery,
  webhookRetryDelay,
  type WebhookDeliveryJob,
} from '#src/modules/webhook-subscriptions/webhook-dispatcher.js';

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const REDIS_URL = process.env.REDIS_URL;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
if (!ADMIN_URL || !REDIS_URL) {
  throw new Error('webhook-delivery-retry 需要 DATABASE_URL_ADMIN / REDIS_URL，由 tests/setup/feature.env.ts 提供');
}

const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `webhook-retry-${randomUUID()}`;
const connection = { url: REDIS_URL };
const queue = new Queue(MARK, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'custom' } },
});
let subscriptionId = '';
const statuses: number[] = [];

beforeAll(async () => {
  const sub = await adminDb.webhookSubscription.create({
    data: { tenantId: TENANT_A, url: `https://93.184.216.34/${MARK}`, events: ['case.created'], secret: 's' },
  });
  subscriptionId = sub.id;
  vi.stubGlobal('fetch', async () => {
    const status = statuses.length === 0 ? 500 : 200;
    statuses.push(status);
    return new Response('', { status });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await adminDb.webhookSubscription.deleteMany({ where: { id: subscriptionId } });
  await queue.obliterate({ force: true });
  await queue.close();
  await adminDb.$disconnect();
});

function startWorker() {
  return new Worker(MARK, processWebhookDelivery(adminDb) as never, {
    connection,
    settings: { backoffStrategy: webhookRetryDelay },
  });
}

test('重試期間 API 重新啟動：新的 Worker 繼續送出第二次', async () => {
  const eventId = randomUUID();
  const data: WebhookDeliveryJob = {
    tenantId: TENANT_A,
    subscriptionId,
    eventId,
    eventName: 'case.created',
    payload: { id: eventId, event: 'case.created' },
  };

  const first = startWorker();
  const failedOnce = new Promise<void>((resolve) => first.on('failed', () => resolve()));
  await queue.add('webhook:deliver', data, { jobId: `${eventId}__${subscriptionId}` });
  await failedOnce;
  // API 結束：重試排在 1 秒之後，還沒執行
  await first.close();
  assert.deepEqual(statuses, [500]);

  const second = startWorker();
  const completed = new Promise<void>((resolve) => second.on('completed', () => resolve()));
  await completed;
  await second.close();

  assert.deepEqual(statuses, [500, 200]);
  const deliveries = await adminDb.webhookDelivery.findMany({ where: { subscriptionId, eventId } });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].attempts, 2);
  assert.equal(deliveries[0].success, true);
});
