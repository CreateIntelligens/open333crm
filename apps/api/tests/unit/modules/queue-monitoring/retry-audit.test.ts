/**
 * 重送 job 寫入平台稽核（change queue-monitoring：queue-monitoring「重送 job 寫入平台稽核」）。
 *
 * 稽核在回應送出之後的 onResponse hook 寫入，所以測試等待 hook 跑完再檢查。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import {
  buildQueueMonitoringApp,
  OFFICE_IP,
  PLATFORM_USER_ID,
  QUEUES_PATH,
  type QueueMonitoringApp,
} from '../../../support/queue-monitoring-app.js';
import { fakeBullQueue, type FakeQueueHandle } from '../../../support/fake-bull-queue.js';

let ctx: QueueMonitoringApp;
let cookie: string;
let webhook: FakeQueueHandle;

beforeAll(async () => {
  webhook = fakeBullQueue('event-webhook');
  ctx = await buildQueueMonitoringApp({ allowedCidrs: '60.248.142.0/24', queues: [webhook.queue] });
  cookie = await ctx.sessionCookie(OFFICE_IP);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(() => {
  ctx.audits.length = 0;
  webhook.jobs.clear();
  webhook.jobs.set('j1', { id: 'j1', name: 'deliver', state: 'failed', data: {} });
  webhook.jobs.set('j2', { id: 'j2', name: 'deliver', state: 'completed', data: {} });
});

const retry = (jobId: string) =>
  ctx.inject({ method: 'PUT', url: `${QUEUES_PATH}/api/queues/event-webhook/${jobId}/retry`, ip: OFFICE_IP, cookie });

/** 等 onResponse hook 跑完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('重送成功時寫入稽核', async () => {
  const res = await retry('j1');
  assert.ok(res.statusCode >= 200 && res.statusCode < 300, res.body);

  await vi.waitFor(() => assert.equal(ctx.audits.length, 1));
  const audit = ctx.audits[0];
  assert.equal(audit.action, 'queue.job.retry');
  assert.equal(audit.targetType, 'queue_job');
  assert.equal(audit.platformUserId, PLATFORM_USER_ID);
  assert.match(String(audit.targetId), /event-webhook/);
  assert.match(String(audit.targetId), /j1/);
});

test('被拒絕的重送不寫入稽核', async () => {
  const res = await retry('j2');
  assert.equal(res.statusCode, 403);

  await settle();
  assert.deepEqual(ctx.audits, []);
});

test('讀取 job 不寫入稽核', async () => {
  await ctx.inject({ method: 'GET', url: `${QUEUES_PATH}/api/queues/event-webhook/j1/logs`, ip: OFFICE_IP, cookie });

  await settle();
  assert.deepEqual(ctx.audits, []);
});
