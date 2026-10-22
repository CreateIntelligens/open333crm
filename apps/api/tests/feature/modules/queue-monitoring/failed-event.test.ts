/**
 * 告警只在 job 移到 failed set 時發出（change queue-monitoring：queue-monitoring「job 移到 failed set 時發出告警」，
 * Scenario「還會重試的失敗」「重試用完」）。
 *
 * 用真實 Redis 與 BullMQ：QueueEvents 的 failed 事件只在 job 移到 failed set 時寫入，重試時寫入的是 delayed。
 * 佇列名稱以 MARK 為前綴，避免碰到其他測試。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, test, vi } from 'vitest';
import { Queue, QueueEvents, UnrecoverableError, Worker } from 'bullmq';
import { startFailedAlerts } from '#src/modules/queue-monitoring/failed-alerts.js';
import type { OpsAlert } from '#src/modules/ops-alert/ops-alert.service.js';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error('failed-event 需要 REDIS_URL，由 tests/setup/feature.env.ts 提供');

const MARK = `failed-event-${randomUUID()}`;
const connection = { url: REDIS_URL };
const queue = new Queue(MARK, { connection });
const alerts: OpsAlert[] = [];
const attempts: Array<{ jobId: string; attempt: number }> = [];
let queueEvents: QueueEvents | undefined;

const worker = new Worker(
  MARK,
  async (job) => {
    attempts.push({ jobId: job.id!, attempt: job.attemptsMade + 1 });
    if (job.name === 'unrecoverable') throw new UnrecoverableError('不可重試');
    throw new Error('HTTP 500');
  },
  { connection, autorun: false },
);

const alerting = startFailedAlerts({
  queueNames: [MARK],
  createQueueEvents: (name) => {
    queueEvents = new QueueEvents(name, { connection });
    return queueEvents;
  },
  getJob: async (_name, jobId) => queue.getJob(jobId),
  sendAlert: async (alert) => {
    alerts.push(alert);
  },
  dashboardUrl: 'https://crm.example/api/v1/platform/queues',
});

beforeAll(async () => {
  // QueueEvents 從最新的事件開始讀：先等它連上，再加入 job
  await queueEvents!.waitUntilReady();
  worker.run();
});
afterAll(async () => {
  await worker.close();
  await alerting.close();
  await queue.obliterate({ force: true });
  await queue.close();
});

test('還會重試的失敗不發出告警，重試用完時發出一則', async () => {
  const job = await queue.add('deliver', { tenantId: 't1' }, { attempts: 3, backoff: { type: 'fixed', delay: 500 } });

  await vi.waitFor(() => assert.ok(attempts.some((a) => a.jobId === job.id && a.attempt === 1)), { timeout: 5_000 });
  // 第 1 次失敗之後 job 等待重試（delayed），QueueEvents 不寫入 failed 事件
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(alerts.filter((a) => a.fields['job id'] === job.id), []);

  await vi.waitFor(() => assert.equal(alerts.filter((a) => a.fields['job id'] === job.id).length, 1), { timeout: 10_000 });
  assert.equal(attempts.filter((a) => a.jobId === job.id).length, 3);
  const alert = alerts.find((a) => a.fields['job id'] === job.id)!;
  assert.equal(alert.fields['重試次數'], 3);
  assert.equal(alert.fields['租戶 id'], 't1');
});

test('job 丟出不可重試的錯誤時發出告警', async () => {
  const job = await queue.add('unrecoverable', {}, { attempts: 3, backoff: { type: 'fixed', delay: 500 } });

  await vi.waitFor(() => assert.equal(alerts.filter((a) => a.fields['job id'] === job.id).length, 1), { timeout: 10_000 });
  assert.equal(attempts.filter((a) => a.jobId === job.id).length, 1);
});
