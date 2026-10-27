/**
 * 其他來源的頁面不能帶監控 cookie 呼叫佇列監控（change queue-monitoring：queue-monitoring
 * 「以平台 JWT 換發監控用的 cookie」）。
 *
 * SameSite=Strict 只擋其他網站（site）。同一個上層網域的其他子網域是 same-site，瀏覽器照樣送出 cookie；
 * 全域 CORS 又反射任何 Origin 並允許 credentials。所以監控路徑自己檢查 Origin。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import { buildQueueMonitoringApp, OFFICE_IP, QUEUES_PATH, type QueueMonitoringApp } from '../../../support/queue-monitoring-app.js';
import { fakeBullQueue, type FakeQueueHandle } from '../../../support/fake-bull-queue.js';

let ctx: QueueMonitoringApp;
let cookie: string;
let webhook: FakeQueueHandle;
/** fastify.inject() 預設的 Host */
const SELF = 'http://localhost:80';
const SIBLING = 'https://other.create360.ai';

beforeAll(async () => {
  webhook = fakeBullQueue('event-webhook');
  ctx = await buildQueueMonitoringApp({ allowedCidrs: '60.248.142.0/24', queues: [webhook.queue] });
  cookie = await ctx.sessionCookie(OFFICE_IP);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(() => {
  webhook.retries.length = 0;
  webhook.jobs.set('j1', { id: 'j1', name: 'deliver', state: 'failed', data: {} });
});

const call = (method: string, path: string, origin?: string) =>
  ctx.inject({ method: method as never, url: `${QUEUES_PATH}${path}`, ip: OFFICE_IP, cookie, headers: origin ? { origin } : {} });

test('其他來源的頁面帶監控 cookie 呼叫', async () => {
  const res = await call('PUT', '/api/queues/event-webhook/j1/retry', SIBLING);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(webhook.retries, []);
});

test('其他來源的頁面帶監控 cookie 讀取 job', async () => {
  const res = await call('GET', '/api/queues/event-webhook/j1', SIBLING);

  assert.equal(res.statusCode, 403);
});

test('同一個來源的請求照常放行', async () => {
  const res = await call('PUT', '/api/queues/event-webhook/j1/retry', SELF);

  assert.ok(res.statusCode >= 200 && res.statusCode < 300, `${res.statusCode} ${res.body}`);
});

test('格式錯誤的 Origin 視為其他來源', async () => {
  const res = await call('GET', '/api/queues/event-webhook/j1', 'null');

  assert.equal(res.statusCode, 403);
});
