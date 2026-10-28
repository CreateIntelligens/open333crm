/**
 * contact 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：客服手動合併與解除合併。
 * - 稽核與合併在同一個交易寫入；推播在 commit 之後送出。
 * - 合併失敗，或稽核寫入失敗時，整筆 rollback，不推播。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 * 合併引擎以 vi.mock 替換：引擎本身的行為由 contact-merge.test.ts 檢查；
 * 引擎失敗時丟出 AppError，與真實的引擎相同。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { AppError } from '#src/shared/utils/response.js';
import { createFlowLog, mockTransactionPrisma, recordingIo, type FlowLog } from '#tests/support/flow-harness.js';

const engine = vi.hoisted(() => ({
  mergeContacts: vi.fn(),
  revertMerge: vi.fn(),
}));
vi.mock('#src/modules/contact/contact-merge.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mergeContacts: engine.mergeContacts,
  revertMerge: engine.revertMerge,
}));

const { mergeContactsFlow, revertMergeFlow } = await import('#src/modules/contact/contact.flow.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const actor = { tenantId: TENANT_ID, agentId: 'agent-1', roleId: 'role-1', ip: '10.0.0.1' };

function auditTx(log: FlowLog, fail = false) {
  return {
    tenantAuditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        if (fail) throw new Error('audit insert failed');
        log.entries.push(`audit:${data.action}`);
        return data;
      },
    },
  };
}

function depsOf(log: FlowLog, failAudit = false) {
  return { prisma: mockTransactionPrisma(log, auditTx(log, failAudit)), io: recordingIo(log) };
}

beforeEach(() => {
  engine.mergeContacts.mockReset();
  engine.revertMerge.mockReset();
});

const mergeResult = {
  mergeLogId: 'log-1',
  survivor: { id: 'P', displayName: '保留方' },
  merged: { id: 'S', displayName: '被合併方' },
  moved: {},
};

test('合併：引擎與稽核在同一個交易，contact.merged 在 commit 之後推播', async () => {
  const log = createFlowLog();
  engine.mergeContacts.mockImplementation(async () => {
    log.entries.push('merge');
    return mergeResult;
  });

  const result = await mergeContactsFlow(depsOf(log), actor, { primaryContactId: 'P', secondaryContactId: 'S' });

  assert.deepEqual(log.entries, ['merge', 'audit:contact.merge', 'commit', 'push:contact.merged']);
  assert.deepEqual(engine.mergeContacts.mock.calls[0][1], {
    survivorId: 'P',
    mergedId: 'S',
    source: 'MANUAL',
    actorAgentId: 'agent-1',
  });
  assert.equal(engine.mergeContacts.mock.calls[0][0].tenantId, TENANT_ID);
  assert.deepEqual(log.pushes, [
    {
      room: `tenant:${TENANT_ID}`,
      event: 'contact.merged',
      data: { primaryContactId: 'P', secondaryContactId: 'S', primaryName: '保留方', secondaryName: '被合併方' },
    },
  ]);
  assert.deepEqual(result, {
    primaryContactId: 'P',
    secondaryContactId: 'S',
    primaryName: '保留方',
    secondaryName: '被合併方',
    mergeLogId: 'log-1',
  });
});

test('合併：引擎拒絕時 rollback，不寫稽核，不推播', async () => {
  const log = createFlowLog();
  engine.mergeContacts.mockRejectedValue(new AppError('無法合併', 'SAME_CHANNEL_CONFLICT', 409));

  await assert.rejects(
    () => mergeContactsFlow(depsOf(log), actor, { primaryContactId: 'P', secondaryContactId: 'S' }),
    (err: unknown) => err instanceof AppError && err.code === 'SAME_CHANNEL_CONFLICT',
  );

  assert.deepEqual(log.entries, ['rollback']);
  assert.deepEqual(log.pushes, []);
});

test('合併：稽核寫入失敗時整筆 rollback，不推播', async () => {
  const log = createFlowLog();
  engine.mergeContacts.mockImplementation(async () => {
    log.entries.push('merge');
    return mergeResult;
  });

  await assert.rejects(
    () => mergeContactsFlow(depsOf(log, true), actor, { primaryContactId: 'P', secondaryContactId: 'S' }),
    /audit insert failed/,
  );

  assert.deepEqual(log.entries, ['merge', 'rollback']);
  assert.deepEqual(log.pushes, []);
});

const revertResult = { survivorId: 'P', holderId: 'H', restoredContactId: 'S', source: 'MANUAL' };

test('解除合併：引擎與稽核在同一個交易，contact.merge_reverted 在 commit 之後推播', async () => {
  const log = createFlowLog();
  engine.revertMerge.mockImplementation(async () => {
    log.entries.push('revert');
    return revertResult;
  });

  const result = await revertMergeFlow(depsOf(log), actor, 'log-1');

  assert.deepEqual(log.entries, ['revert', 'audit:contact.merge_revert', 'commit', 'push:contact.merge_reverted']);
  assert.deepEqual(engine.revertMerge.mock.calls[0][1], { mergeLogId: 'log-1', revertedBy: 'agent-1' });
  // 推播的 survivorId 是目前持有資料的聯絡人（holderId），與搬遷前相同
  assert.deepEqual(log.pushes, [
    {
      room: `tenant:${TENANT_ID}`,
      event: 'contact.merge_reverted',
      data: { mergeLogId: 'log-1', survivorId: 'H', restoredContactId: 'S' },
    },
  ]);
  assert.deepEqual(result, revertResult);
});

test('解除合併：稽核寫入失敗時整筆 rollback，不推播', async () => {
  const log = createFlowLog();
  engine.revertMerge.mockImplementation(async () => {
    log.entries.push('revert');
    return revertResult;
  });

  await assert.rejects(() => revertMergeFlow(depsOf(log, true), actor, 'log-1'), /audit insert failed/);

  assert.deepEqual(log.entries, ['revert', 'rollback']);
  assert.deepEqual(log.pushes, []);
});
