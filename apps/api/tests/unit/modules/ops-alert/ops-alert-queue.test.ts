/**
 * ops-alert 佇列的 job 選項與告警監聽範圍（change queue-monitoring：ops-alert「送出告警至少一次」，
 * Scenario「Slack 持續無法連線」）。
 *
 * 送出告警失敗時重試 3 次；重試用完時只記 log，因為 ops-alert 佇列不在告警監聽的清單內，不發出新的告警。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const queues = vi.hoisted(() => [] as Array<{ name: string; opts: { defaultJobOptions?: Record<string, unknown> } }>);
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    constructor(name: string, opts: { defaultJobOptions?: Record<string, unknown> }) {
      queues.push({ name, opts });
    }
    async add() {}
  },
}));

import { OPS_ALERT_QUEUE, sendOpsAlert } from '#src/modules/ops-alert/ops-alert.service.js';
import { ALERTED_QUEUES, MONITORED_QUEUES } from '#src/modules/queue-monitoring/monitored-queues.js';

test('Slack 持續無法連線：ops-alert 佇列重試 3 次，重試用完不發出新的告警', async () => {
  // 單元測試的 Redis 指令一律失敗（tests/setup/unit.setup.ts），只檢查建立佇列時的選項
  await sendOpsAlert({ key: 'k', title: 't', fields: {} }).catch(() => undefined);

  const queue = queues.find((q) => q.name === OPS_ALERT_QUEUE);
  assert.ok(queue, 'ops-alert 佇列沒有建立');
  assert.equal(queue.opts.defaultJobOptions?.attempts, 3);
  assert.deepEqual(queue.opts.defaultJobOptions?.backoff, { type: 'exponential', delay: 5_000 });
  assert.deepEqual(queue.opts.defaultJobOptions?.removeOnComplete, { age: 86_400 });
  assert.deepEqual(queue.opts.defaultJobOptions?.removeOnFail, { age: 604_800 });

  assert.ok(MONITORED_QUEUES.includes(OPS_ALERT_QUEUE), '監控畫面列出 ops-alert 佇列');
  assert.ok(!ALERTED_QUEUES.includes(OPS_ALERT_QUEUE), 'ops-alert 佇列不在告警監聽的清單內');
});
