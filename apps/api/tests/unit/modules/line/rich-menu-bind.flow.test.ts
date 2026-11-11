/**
 * 圖文選單的分眾綁定經 outbox 送出（change migrate-line-tenant-ctx，spec line-rich-menu
 * 「背景綁定只綁到仍在發布中的選單」的「Redis 無法使用時發起綁定」、「Rich Menu Audience Binding」）。
 *
 * 綁定工作在交易內寫進 outbox，commit 之後送出（至少一次）。快路徑送不出時（Redis 無法使用），
 * 請求仍回成功，由 outbox-relay 補送。保留期限（queue-monitoring）改由工作的選項指定。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { OutboxInput } from '@open333crm/core';
import { AppError } from '#src/shared/utils/response.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher } from '#tests/support/flow-harness.js';
import { MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';

const queueAdds = vi.hoisted(() => [] as unknown[]);
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    async add(...args: unknown[]) {
      queueAdds.push(args);
    }
  },
}));

import { bindRichMenuAudienceFlow, unbindRichMenuAudienceFlow } from '#src/modules/line/rich-menu.flow.js';

const TAG = 'd0000000-0000-4000-8000-000000000001';

function setup(menu: Record<string, unknown> = {}) {
  const log = createFlowLog();
  const jobs: Array<Extract<OutboxInput, { kind: 'job' }>> = [];
  const base = recordingPublisher(log);
  const events = {
    ...base,
    write: (tx: Parameters<typeof base.write>[0], input: OutboxInput) => {
      if (input.kind === 'job') jobs.push(input);
      return base.write(tx, input);
    },
    // 快路徑送不出：Redis 無法使用
    dispatch: async () => {
      throw new Error('Redis connection refused');
    },
  };
  const tx = {
    richMenu: {
      findFirst: async () => ({
        id: 'rm-1',
        tenantId: MOCK_TENANT_ID,
        channelId: 'ch-1',
        status: 'published',
        lineRichMenuId: 'line-1',
        ...menu,
      }),
    },
    contactTag: { findMany: async () => [{ contactId: 'c-1' }, { contactId: 'c-2' }] },
    channelIdentity: { findMany: async () => [{ uid: 'U1' }, { uid: 'U2' }] },
  };
  return { prisma: mockTransactionPrisma(log, tx), events, jobs, log };
}

test('Redis 無法使用時發起綁定：綁定工作寫進 outbox，回傳排入人數，不直接送進佇列', async () => {
  queueAdds.length = 0;
  const { prisma, events, jobs, log } = setup();

  const result = await bindRichMenuAudienceFlow({ prisma, events }, MOCK_TENANT_ID, 'rm-1', { tagId: TAG });

  assert.deepEqual(result, { queued: 2 });
  assert.equal(queueAdds.length, 0, '綁定工作不可直接 queue.add()');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].queueName, 'rich-menu-bind');
  assert.equal(jobs[0].name, 'bind');
  assert.deepEqual(jobs[0].payload, {
    tenantId: MOCK_TENANT_ID,
    channelId: 'ch-1',
    richMenuId: 'rm-1',
    lineRichMenuId: 'line-1',
    uids: ['U1', 'U2'],
    op: 'link',
  });
  assert.ok(log.entries.indexOf('event:bind') < log.entries.indexOf('commit'), '綁定工作在交易內寫入');
});

test('綁定工作的保留期限：completed 保留 24 小時，failed 保留 7 天', async () => {
  const { prisma, events, jobs } = setup();
  await bindRichMenuAudienceFlow({ prisma, events }, MOCK_TENANT_ID, 'rm-1', { tagId: TAG });
  assert.equal(jobs.length, 1, '綁定工作沒有寫進 outbox');
  assert.deepEqual(jobs[0].jobOptions, { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } });
});

test('解除綁定：工作帶選單 id，op 是 unlink', async () => {
  const { prisma, events, jobs } = setup();
  const result = await unbindRichMenuAudienceFlow({ prisma, events }, MOCK_TENANT_ID, 'rm-1', { tagId: TAG });
  assert.deepEqual(result, { queued: 2 });
  assert.equal(jobs.length, 1, '解除綁定工作沒有寫進 outbox');
  assert.equal(jobs[0].name, 'unbind');
  assert.equal((jobs[0].payload as { op: string; richMenuId: string }).op, 'unlink');
  assert.equal((jobs[0].payload as { richMenuId: string }).richMenuId, 'rm-1');
});

test('Binding a draft menu is rejected：草稿回 400 NOT_PUBLISHED，不寫綁定工作', async () => {
  const { prisma, events, jobs } = setup({ status: 'draft', lineRichMenuId: null });
  await assert.rejects(
    bindRichMenuAudienceFlow({ prisma, events }, MOCK_TENANT_ID, 'rm-1', { tagId: TAG }),
    (err: unknown) => err instanceof AppError && err.code === 'NOT_PUBLISHED' && err.statusCode === 400,
  );
  assert.equal(jobs.length, 0);
});
