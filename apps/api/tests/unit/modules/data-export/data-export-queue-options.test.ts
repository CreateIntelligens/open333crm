/**
 * data-export 佇列的保留期限（queue-monitoring「各佇列 job 的保留期限」）：
 * completed job 保留 24 小時，failed job 保留 7 天。
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

import { DATA_EXPORT_QUEUE, requestExport } from '#src/modules/data-export/data-export.service.js';

test('data-export 佇列：completed job 保留 24 小時，failed job 保留 7 天', async () => {
  const prisma = {
    dataExportRequest: {
      create: async () => ({ id: 'r1', status: 'pending', scope: null, createdAt: new Date() }),
    },
    tenantAuditLog: { create: async () => ({}) },
  };

  await requestExport(prisma as never, { tenantId: 't1', requestedBy: 'a1' });

  const queue = queues.find((q) => q.name === DATA_EXPORT_QUEUE);
  assert.ok(queue, 'data-export 佇列沒有建立');
  assert.deepEqual(queue.opts.defaultJobOptions?.removeOnComplete, { age: 86_400 });
  assert.deepEqual(queue.opts.defaultJobOptions?.removeOnFail, { age: 604_800 });
});
