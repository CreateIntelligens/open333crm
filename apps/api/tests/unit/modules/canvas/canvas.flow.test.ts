/**
 * 手動觸發在 execution commit 之後才開始執行（change migrate-canvas-tenant-ctx，spec interaction-canvas）。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。流程引擎以注入的 runFlow 取代。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { FlowRunner, logger } from '@open333crm/core';
import { createFlowLog, mockTransactionPrisma, type FlowLog } from '#tests/support/flow-harness.js';
import { triggerFlowFlow } from '#src/modules/canvas/canvas.flow.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const input = { flowId: 'flow-1', contactId: 'contact-1', vars: { a: 1 } };

/** 流程是 ACTIVE、聯絡人存在；建立 execution 時記一筆 'create' */
function triggerTx(log: FlowLog) {
  return {
    interactionFlow: { findFirst: async () => ({ id: input.flowId, tenantId: TENANT_ID, status: 'ACTIVE' }) },
    contact: { findFirst: async () => ({ id: input.contactId }) },
    flowExecution: {
      create: async () => {
        log.entries.push('create');
        return { id: 'exec-1' };
      },
    },
  };
}

/** callback 跑完之後 commit 失敗（例如序列化衝突），交易 rollback */
function failingCommitPrisma(log: FlowLog, tx: Record<string, unknown>) {
  return {
    async $transaction(cb: (t: unknown) => Promise<unknown>) {
      await cb({ $executeRaw: async () => 1, ...tx });
      log.entries.push('rollback');
      throw new Error('commit failed');
    },
  } as never;
}

function recordingRunFlow(log: FlowLog, result: () => Promise<void> = async () => {}) {
  return vi.fn((executionId: string) => {
    log.entries.push(`run:${executionId}`);
    return result();
  });
}

beforeEach(() => {
  // 引擎以 spy 取代，免得單元測試連線資料庫。「rollback 時不開始執行」也檢查 flow 沒有繞過 runFlow 直接呼叫引擎
  vi.spyOn(FlowRunner, 'run').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

test('commit 之後開始執行', async () => {
  const log = createFlowLog();
  const runFlow = recordingRunFlow(log);

  const result = await triggerFlowFlow({ prisma: mockTransactionPrisma(log, triggerTx(log)), runFlow }, TENANT_ID, input);

  assert.equal(result, 'exec-1');
  assert.deepEqual(log.entries, ['create', 'commit', 'run:exec-1']);
  assert.equal(runFlow.mock.calls.length, 1);
});

test('rollback 時不開始執行', async () => {
  const log = createFlowLog();
  const runFlow = recordingRunFlow(log);

  await assert.rejects(
    triggerFlowFlow({ prisma: failingCommitPrisma(log, triggerTx(log)), runFlow }, TENANT_ID, input),
    /commit failed/,
  );

  assert.deepEqual(log.entries, ['create', 'rollback']);
  assert.equal(runFlow.mock.calls.length, 0);
  assert.equal((FlowRunner.run as unknown as { mock: { calls: unknown[] } }).mock.calls.length, 0);
});

test('流程執行失敗不影響回應', async () => {
  const log = createFlowLog();
  const runFlow = recordingRunFlow(log, async () => {
    throw new Error('node failed');
  });
  const logged = vi.spyOn(logger, 'error').mockImplementation(() => logger);

  const result = await triggerFlowFlow({ prisma: mockTransactionPrisma(log, triggerTx(log)), runFlow }, TENANT_ID, input);
  await vi.waitFor(() => assert.equal(logged.mock.calls.length, 1));

  assert.equal(result, 'exec-1');
  assert.match(String(logged.mock.calls[0][0]), /exec-1/);
});
