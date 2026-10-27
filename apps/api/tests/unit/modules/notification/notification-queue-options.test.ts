/**
 * API 的 notification 佇列的 job 選項（standalone-worker-runtime「Notification Job Handling」：
 * Scenario「Both producers set the retry policy」「Database write keeps failing」）。
 * 寫入失敗時由 BullMQ 重試 3 次，第 3 次失敗後 job 移到 failed set。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-notification-queue-options-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

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

import { loadEnvConfig } from '#src/config/env.js';
import { setupNotificationWorker } from '#src/modules/notification/notification.worker.js';

loadEnvConfig();

test('Both producers set the retry policy：API 的 notification 佇列重試 3 次、指數退避 5 秒', async () => {
  const handle = setupNotificationWorker({} as never);
  await handle({
    id: 'evt-1',
    name: 'case.assigned' as never,
    tenantId: 't1',
    timestamp: new Date(),
    payload: { caseId: 'c1', assigneeId: 'a1' },
  });

  const queue = queues.find((q) => q.name === 'notification');
  assert.ok(queue, 'notification 佇列沒有建立');
  assert.equal(queue.opts.defaultJobOptions?.attempts, 3);
  assert.deepEqual(queue.opts.defaultJobOptions?.backoff, { type: 'exponential', delay: 5_000 });
});
