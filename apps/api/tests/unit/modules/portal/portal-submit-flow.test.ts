/**
 * 粉絲送出活動的 flow（#337 階段 3，AGENTS.md 結構規則 2）：
 * 作答、積分與 portal.activity.submitted 事件在同一個交易寫入，事件在 commit 之後才送出；
 * 積分寫不進去時 rollback，事件不送出。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createFlowLog, mockTransactionPrisma, recordingPublisher } from '#tests/support/flow-harness.js';
import { MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';
import { submitActivityFlow } from '#src/modules/portal/portal.flow.js';

const fan = { tenantId: MOCK_TENANT_ID, contactId: 'contact-1' };

function flowTx(log: ReturnType<typeof createFlowLog>, pointsFail = false) {
  return {
    portalActivity: {
      findFirst: async () => ({
        id: 'activity-1',
        type: 'POLL',
        title: '投票',
        settings: { pointsPerSubmit: 5 },
        startsAt: null,
        endsAt: null,
        options: [],
      }),
    },
    portalSubmission: {
      findFirst: async () => null,
      create: async () => {
        log.entries.push('write:submission');
        return { id: 'submission-1' };
      },
    },
    pointTransaction: {
      findFirst: async () => null,
      create: async () => {
        if (pointsFail) throw new Error('points failed');
        log.entries.push('write:points');
        return {};
      },
    },
  };
}

test('作答、積分與事件在同一個交易寫入，commit 之後才送出事件', async () => {
  const log = createFlowLog();
  const result = await submitActivityFlow(
    { prisma: mockTransactionPrisma(log, flowTx(log)), events: recordingPublisher(log) },
    fan,
    'activity-1',
    { optionIds: [] },
  );

  assert.deepEqual(result, { id: 'submission-1' });
  assert.deepEqual(log.entries, [
    'write:submission',
    'write:points',
    'event:portal.activity.submitted',
    'commit',
    'dispatch:portal.activity.submitted',
  ]);
  assert.deepEqual(log.events[0].payload, {
    activityId: 'activity-1',
    contactId: 'contact-1',
    submissionId: 'submission-1',
    activityType: 'POLL',
  });
});

test('積分寫不進去時 rollback，不送出事件', async () => {
  const log = createFlowLog();
  await assert.rejects(
    () =>
      submitActivityFlow(
        { prisma: mockTransactionPrisma(log, flowTx(log, true)), events: recordingPublisher(log) },
        fan,
        'activity-1',
        {},
      ),
    /points failed/,
  );
  assert.ok(log.entries.includes('rollback'));
  assert.ok(!log.entries.some((e) => e.startsWith('event:') || e.startsWith('dispatch:')));
});
