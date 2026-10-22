/**
 * rich-menu-bind 佇列的保留期限（queue-monitoring「各佇列 job 的保留期限」）：
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

import { RICH_MENU_BIND_QUEUE, unbindRichMenuFromAudience } from '#src/modules/line/rich-menu.service.js';

test('rich-menu-bind 佇列：completed job 保留 24 小時，failed job 保留 7 天', async () => {
  const prisma = {
    richMenu: { findFirst: async () => ({ id: 'm1', channelId: 'ch1', lineRichMenuId: 'rm1' }) },
    contactTag: { findMany: async () => [{ contactId: 'c1' }] },
    channelIdentity: { findMany: async () => [{ uid: 'U1' }] },
  };

  await unbindRichMenuFromAudience(prisma as never, 'm1', 't1', { tagId: 'tag1' });

  const queue = queues.find((q) => q.name === RICH_MENU_BIND_QUEUE);
  assert.ok(queue, 'rich-menu-bind 佇列沒有建立');
  assert.deepEqual(queue.opts.defaultJobOptions?.removeOnComplete, { age: 86_400 });
  assert.deepEqual(queue.opts.defaultJobOptions?.removeOnFail, { age: 604_800 });
});
