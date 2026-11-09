import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

/**
 * workers 的 notification 佇列的 job 選項（standalone-worker-runtime「Notification Job Handling」：
 * Scenario「Both producers set the retry policy」「Database write keeps failing」）。
 */

const queues = vi.hoisted(() => [] as Array<{ name: string; opts: { defaultJobOptions?: Record<string, unknown> } }>);
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    constructor(name: string, opts: { defaultJobOptions?: Record<string, unknown> }) {
      queues.push({ name, opts });
    }
    async add() {}
    async close() {}
  },
}));
const clients = vi.hoisted(() => [] as Array<{ purpose: string; quit: ReturnType<typeof vi.fn> }>);
vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  createRedisClient: (_url: string, purpose: string) => {
    const client = { purpose, quit: vi.fn(async () => 'OK') };
    clients.push(client);
    return client;
  },
}));

process.env.REDIS_URL ||= 'redis://localhost:6379';

import { closeNotificationQueue, enqueueNotification } from '#src/lib/notification-queue';

test('Both producers set the retry policy：workers 的 notification 佇列重試 3 次、指數退避 5 秒', async () => {
  await enqueueNotification({ tenantId: 't1', agentId: 'a1', type: 'sla_warning', title: 'T', body: 'B' });
  await closeNotificationQueue();

  const queue = queues.find((q) => q.name === 'notification');
  assert.ok(queue, 'notification 佇列沒有建立');
  assert.equal(queue.opts.defaultJobOptions?.attempts, 3);
  assert.deepEqual(queue.opts.defaultJobOptions?.backoff, { type: 'exponential', delay: 5_000 });
});

test('BullMQ 用途的連線：關閉佇列時一起關閉', async () => {
  clients.length = 0;
  await enqueueNotification({ tenantId: 't1', agentId: 'a1', type: 'sla_warning', title: 'T', body: 'B' });
  assert.deepEqual(clients.map((c) => c.purpose), ['queue']);

  await closeNotificationQueue();
  assert.equal(clients[0].quit.mock.calls.length, 1, '關閉佇列後連線沒有關閉');
});
