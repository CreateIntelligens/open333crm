/**
 * 經監控路由讀取 job 的細節（change queue-monitoring：queue-monitoring「列出所有佇列」的 Scenario
 * 「顯示失敗原因」，「job 資料只顯示識別欄位」）。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { buildQueueMonitoringApp, OFFICE_IP, QUEUES_PATH, type QueueMonitoringApp } from '../../../support/queue-monitoring-app.js';
import { fakeBullQueue } from '../../../support/fake-bull-queue.js';
import { MASKED } from '#src/modules/queue-monitoring/mask-job-data.js';

let ctx: QueueMonitoringApp;
let cookie: string;

beforeAll(async () => {
  const webhook = fakeBullQueue('event-webhook', [
    {
      id: 'j1',
      name: 'deliver',
      state: 'failed',
      data: { tenantId: 't1', payload: { content: '我的電話是 0912…' } },
      failedReason: 'HTTP 500',
      stacktrace: ['Error: HTTP 500\n    at deliver (webhook-delivery.ts:1:1)'],
      attemptsMade: 3,
    },
  ], [
    { key: 'digest', name: 'digest', every: 60_000, template: { data: { tenantId: 't1', content: '我的電話是 0912…' } } },
  ]);
  ctx = await buildQueueMonitoringApp({ allowedCidrs: '60.248.142.0/24', queues: [webhook.queue] });
  cookie = await ctx.sessionCookie(OFFICE_IP);
});
afterAll(async () => {
  await ctx.app.close();
});

async function getJob() {
  const res = await ctx.inject({ method: 'GET', url: `${QUEUES_PATH}/api/queues/event-webhook/j1`, ip: OFFICE_IP, cookie });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { job: Record<string, unknown> }).job;
}

test('顯示失敗原因', async () => {
  const job = await getJob();

  assert.equal(job.failedReason, 'HTTP 500');
  assert.match(String((job.stacktrace as string[])[0]), /HTTP 500/);
});

test('畫面的 job 資料已遮蔽', async () => {
  const job = await getJob();

  assert.deepEqual(job.data, { tenantId: 't1', payload: { content: MASKED } });
});

test('排程範本的資料已遮蔽', async () => {
  const res = await ctx.inject({ method: 'GET', url: `${QUEUES_PATH}/api/job-schedulers`, ip: OFFICE_IP, cookie });
  assert.equal(res.statusCode, 200, res.body);

  const { schedulers } = res.json() as { schedulers: Array<{ id: string; template?: { data?: unknown } }> };
  const digest = schedulers.find((s) => s.id === 'digest');
  assert.ok(digest, res.body);
  assert.deepEqual(digest.template?.data, { tenantId: 't1', content: MASKED });
});
