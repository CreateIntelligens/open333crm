/**
 * job 移到 failed set 時發出告警（change queue-monitoring：queue-monitoring「job 移到 failed set 時發出告警」，
 * ops-alert「告警內容不含 job 資料」）。
 *
 * QueueEvents 換成記憶體裡的 EventEmitter。BullMQ 只在 job 移到 failed set 時發出 failed 事件，
 * 這個行為由 tests/feature/modules/queue-monitoring/failed-event.test.ts 以真實的 Redis 確認。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, test } from 'vitest';
import { startFailedAlerts } from '#src/modules/queue-monitoring/failed-alerts.js';
import { ALERTED_QUEUES } from '#src/modules/queue-monitoring/monitored-queues.js';
import type { OpsAlert } from '#src/modules/ops-alert/ops-alert.service.js';

const DASHBOARD = 'https://crm.example/api/v1/platform/queues';

let emitters: Map<string, EventEmitter>;
let alerts: OpsAlert[];
let jobs: Map<string, { name: string; data: unknown; attemptsMade: number }>;

beforeEach(() => {
  emitters = new Map();
  alerts = [];
  jobs = new Map();
});

function start(queueNames: readonly string[] = ALERTED_QUEUES) {
  return startFailedAlerts({
    queueNames,
    createQueueEvents(name) {
      const emitter = new EventEmitter();
      emitters.set(name, emitter);
      return Object.assign(emitter, { close: async () => {} });
    },
    getJob: async (queueName, jobId) => jobs.get(`${queueName}:${jobId}`),
    sendAlert: async (alert) => {
      alerts.push(alert);
    },
    dashboardUrl: DASHBOARD,
  });
}

/** QueueEvents 的 failed 事件只帶 jobId 與 failedReason */
async function fail(queueName: string, jobId: string, failedReason = 'HTTP 500: {"phone":"0912345678"}') {
  emitters.get(queueName)!.emit('failed', { jobId, failedReason }, '1-0');
  await new Promise((resolve) => setImmediate(resolve));
}

test('重試用完', async () => {
  start();
  jobs.set('event-webhook:j1', { name: 'deliver', data: { tenantId: 't1', payload: { secret: 'x' } }, attemptsMade: 3 });

  await fail('event-webhook', 'j1');

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, 'queue-failed:event-webhook');
  assert.equal(alerts[0].fields['佇列'], 'event-webhook');
  assert.equal(alerts[0].fields['job id'], 'j1');
  assert.equal(alerts[0].fields['job 名稱'], 'deliver');
  assert.equal(alerts[0].fields['租戶 id'], 't1');
  assert.equal(alerts[0].fields['重試次數'], 3);
  assert.equal(alerts[0].link, `${DASHBOARD}/queue/event-webhook/j1`);
});

test('告警不含失敗原因', async () => {
  start();
  jobs.set('event-webhook:j1', { name: 'deliver', data: { tenantId: 't1', payload: { phone: '0912345678' } }, attemptsMade: 3 });

  await fail('event-webhook', 'j1');

  const text = JSON.stringify(alerts[0]);
  assert.doesNotMatch(text, /0912345678/);
  assert.doesNotMatch(text, /HTTP 500/);
});

test('workers 行程的佇列', async () => {
  start();
  jobs.set('notification:n1', { name: 'notification:dispatch', data: { tenantId: 't1' }, attemptsMade: 3 });

  await fail('notification', 'n1');

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].fields['佇列'], 'notification');
  assert.equal(alerts[0].key, 'queue-failed:notification');
});

test('告警佇列本身失敗', async () => {
  start();

  assert.ok(!emitters.has('ops-alert'), '不監聽 ops-alert 佇列');
  assert.ok(emitters.has('event-webhook'));
});

test('job 已被刪除時仍發出告警，只帶佇列名稱與 job id', async () => {
  start();

  await fail('automation', 'gone');

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].fields['job id'], 'gone');
  assert.equal(alerts[0].fields['租戶 id'], undefined);
});

test('job 資料最上層沒有 tenantId 時不帶租戶 id', async () => {
  start();
  jobs.set('sla:s1', { name: 'sla:poll', data: {}, attemptsMade: 1 });

  await fail('sla', 's1');

  assert.equal(alerts[0].fields['租戶 id'], undefined);
});

/** 執行 fn，收集期間發生的未處理 rejection */
async function collectUnhandledRejections(fn: () => Promise<void>): Promise<unknown[]> {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    await fn();
    // unhandledRejection 在 microtask 清空之後才發出
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return rejections;
}

function startFailing(
  getJob: () => Promise<{ name: string; data: unknown; attemptsMade: number }>,
  sendAlert: (alert: OpsAlert) => Promise<unknown>,
) {
  startFailedAlerts({
    queueNames: ['automation'],
    createQueueEvents(name) {
      const emitter = new EventEmitter();
      emitters.set(name, emitter);
      return Object.assign(emitter, { close: async () => {} });
    },
    getJob,
    sendAlert,
    dashboardUrl: DASHBOARD,
  });
}

test('讀取 job 失敗時仍送出告警，只帶 job id', async () => {
  startFailing(
    async () => {
      throw new Error('redis down');
    },
    async (alert) => {
      alerts.push(alert);
    },
  );

  const rejections = await collectUnhandledRejections(() => fail('automation', 'j1'));

  assert.deepEqual(rejections, []);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].fields['job id'], 'j1');
  assert.equal(alerts[0].fields['job 名稱'], undefined);
});

test('送出告警失敗時不丟出未處理的錯誤', async () => {
  let sendCalls = 0;
  startFailing(
    async () => ({ name: 'automation:run', data: {}, attemptsMade: 3 }),
    async () => {
      sendCalls += 1;
      throw new Error('redis down');
    },
  );

  const rejections = await collectUnhandledRejections(() => fail('automation', 'j1'));

  assert.equal(sendCalls, 1, '告警有送出');
  assert.deepEqual(rejections, []);
  assert.ok(emitters.get('automation')!.listenerCount('error') > 0, 'QueueEvents 有 error 監聽');
});
