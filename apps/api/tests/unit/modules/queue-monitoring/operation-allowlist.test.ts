/**
 * 佇列監控只放行讀取與重送單一個 failed job（change queue-monitoring：queue-monitoring
 * 「只放行讀取與重送單一個 failed job」）。
 *
 * 被拒絕的路由由 bull-board 的路由清單列舉：bull-board 升級後新增的寫入路由也會被檢查。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
// @ts-expect-error bull-board 沒有為 dist 內部檔案提供型別宣告
import { appRoutes } from '@bull-board/api/dist/routes.js';
import { buildQueueMonitoringApp, OFFICE_IP, QUEUES_PATH, type QueueMonitoringApp } from '../../../support/queue-monitoring-app.js';
import { fakeBullQueue, type FakeQueueHandle } from '../../../support/fake-bull-queue.js';

const RETRY_ROUTE = '/api/queues/:queueName/:jobId/retry';

let ctx: QueueMonitoringApp;
let cookie: string;
let webhook: FakeQueueHandle;
let notification: FakeQueueHandle;
let automation: FakeQueueHandle;

beforeAll(async () => {
  webhook = fakeBullQueue('event-webhook');
  notification = fakeBullQueue('notification');
  automation = fakeBullQueue('automation');
  ctx = await buildQueueMonitoringApp({
    allowedCidrs: '60.248.142.0/24',
    queues: [webhook.queue, notification.queue, automation.queue],
  });
  cookie = await ctx.sessionCookie(OFFICE_IP);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(() => {
  for (const handle of [webhook, notification, automation]) {
    handle.retries.length = 0;
    handle.writes.length = 0;
    handle.jobs.clear();
  }
  webhook.jobs.set('j-failed', { id: 'j-failed', name: 'deliver', state: 'failed', data: { tenantId: 't1' }, failedReason: 'HTTP 500' });
  notification.jobs.set('j-done', { id: 'j-done', name: 'notification:dispatch', state: 'completed', data: { tenantId: 't1' } });
  automation.jobs.set('j-failed', { id: 'j-failed', name: 'automation:evaluate', state: 'failed', data: { tenantId: 't1' } });
});

function call(method: string, path: string, payload?: unknown) {
  return ctx.inject({ method: method as never, url: `${QUEUES_PATH}${path}`, ip: OFFICE_IP, cookie, payload: payload as never });
}

test('重送一個 failed job', async () => {
  const res = await call('PUT', '/api/queues/event-webhook/j-failed/retry');

  assert.ok(res.statusCode >= 200 && res.statusCode < 300, `${res.statusCode} ${res.body}`);
  assert.deepEqual(webhook.retries, [{ id: 'j-failed', state: 'failed' }]);
  assert.equal(webhook.jobs.get('j-failed')!.state, 'waiting');
});

test('重送一個 completed job', async () => {
  const res = await call('PUT', '/api/queues/notification/j-done/retry');

  assert.equal(res.statusCode, 403);
  assert.deepEqual(notification.retries, []);
  assert.equal(notification.jobs.get('j-done')!.state, 'completed');
});

test('重送不存在的 job', async () => {
  const res = await call('PUT', '/api/queues/event-webhook/missing/retry');

  assert.equal(res.statusCode, 403);
});

test('重送整個 failed 狀態', async () => {
  const res = await call('PUT', '/api/queues/event-webhook/retry/failed');

  assert.equal(res.statusCode, 403);
  assert.deepEqual(webhook.writes, []);
  assert.equal(webhook.jobs.get('j-failed')!.state, 'failed');
});

test('刪除整個佇列', async () => {
  for (const action of ['empty', 'obliterate', 'clean/completed', 'clean/failed']) {
    const res = await call('PUT', `/api/queues/automation/${action}`, {});
    assert.equal(res.statusCode, 403, action);
  }
  assert.deepEqual(automation.writes, []);
  assert.equal(automation.jobs.size, 1);
});

test('修改 job 資料', async () => {
  const res = await call('PATCH', '/api/queues/automation/j-failed/update-data', { data: { tenantId: 't2' } });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(automation.jobs.get('j-failed')!.data, { tenantId: 't1' });
});

test('bull-board 的每一條寫入路由都回 403（單筆重送 failed job 除外）', async () => {
  const writeRoutes = (appRoutes.api as Array<{ method: string; route: string }>).filter((r) => r.method !== 'get');
  assert.ok(writeRoutes.length > 20, `只列舉到 ${writeRoutes.length} 條寫入路由`);

  const wrong: string[] = [];
  for (const { method, route } of writeRoutes) {
    if (route === RETRY_ROUTE) continue;
    const path = route
      .replace(':queueName', 'automation')
      .replace(':jobId', 'j-failed')
      .replace(':queueStatus', 'failed')
      .replace(':schedulerId', 's1');
    const res = await call(method.toUpperCase(), path, {});
    if (res.statusCode !== 403) wrong.push(`${method} ${route} → ${res.statusCode}`);
  }

  assert.deepEqual(wrong, []);
  assert.deepEqual(automation.writes, []);
  assert.deepEqual(automation.retries, []);
});

/** 確認過不會回傳未遮蔽 job 資料的讀取路由 */
const ALLOWED_READS = [
  '/api/redis/stats',
  '/api/queues',
  '/api/queues/has-workers',
  '/api/job-schedulers',
  '/api/queues/:queueName/metrics',
  '/api/queues/:queueName/default-job-options',
  '/api/queues/:queueName/workers',
  '/api/queues/:queueName/rate-limit',
  '/api/queues/:queueName/job-data-schema',
  '/api/queues/:queueName/:jobId/flow',
  '/api/queues/:queueName/:jobId',
];

test('放行清單內的讀取路由', async () => {
  const wrong: string[] = [];
  for (const route of ALLOWED_READS) {
    const res = await call('GET', route.replace(':queueName', 'event-webhook').replace(':jobId', 'j-failed'));
    if (res.statusCode === 403) wrong.push(`${route} → 403`);
  }

  assert.deepEqual(wrong, []);
});

test('讀取 job 的 log', async () => {
  const res = await call('GET', '/api/queues/event-webhook/j-failed/logs');

  assert.equal(res.statusCode, 403);
  assert.doesNotMatch(res.body, /0912345678/);
});

test('bull-board 的每一條讀取路由：不在放行清單內的回 403', async () => {
  const reads = (appRoutes.api as Array<{ method: string; route: string }>).filter((r) => r.method === 'get');
  const wrong: string[] = [];
  for (const { route } of reads) {
    if (ALLOWED_READS.includes(route)) continue;
    const res = await call('GET', route.replace(':queueName', 'event-webhook').replace(':jobId', 'j-failed'));
    if (res.statusCode !== 403) wrong.push(`${route} → ${res.statusCode}`);
  }

  assert.deepEqual(wrong, []);
});

test('重送時 job 已不是 failed', async () => {
  // 兩個重送請求同時讀到 failed，第一個重送的 job 已經跑完：第二個請求的 handler 讀到 completed
  const job = webhook.jobs.get('j-failed')!;
  let reads = 0;
  job.onGetState = () => {
    if (++reads === 1) job.state = 'completed';
  };

  const res = await call('PUT', '/api/queues/event-webhook/j-failed/retry');

  assert.ok(res.statusCode >= 400, `${res.statusCode} ${res.body}`);
  assert.deepEqual(webhook.retries, []);
  assert.equal(job.state, 'completed');
});
