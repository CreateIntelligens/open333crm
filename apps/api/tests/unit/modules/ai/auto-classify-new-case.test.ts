/**
 * 新工單的自動分類不可覆蓋已設定的分類（手動建單選的、或自動化規則指定的）。
 * 原本收到 case.created 一定分類並覆寫 category。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { autoClassifyNewCaseFlow } from '#src/modules/ai/ai.flow.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher } from '#tests/support/flow-harness.js';

const T1 = '11111111-1111-4111-8111-111111111111';

/** 交易 1 讀分類與訊息、交易 2 寫入；classifier 換成假的，不呼叫 LLM */
function autoClassifyNewCase(
  tx: unknown,
  tenantId: string,
  caseId: string,
  conversationId: string,
  classify: () => Promise<{ category: string; confidence: number }>,
) {
  const log = createFlowLog();
  const deps = { prisma: mockTransactionPrisma(log, tx as Record<string, unknown>), redis: {} as never, events: recordingPublisher(log) };
  return autoClassifyNewCaseFlow(deps, tenantId, caseId, conversationId, classify);
}

function mockPrisma(category: string | null) {
  const updates: unknown[] = [];
  const prisma = {
    case: {
      findFirst: async () => ({ category }),
      updateMany: async (args: unknown) => {
        updates.push(args);
        return { count: 1 };
      },
    },
    message: { findFirst: async () => ({ content: { text: '我要退貨' } }) },
  } as never;
  return { prisma, updates };
}
const classifier = async () => ({ category: '退換貨', confidence: 0.9 });

test('工單已有分類：不分類、不覆蓋', async () => {
  const { prisma, updates } = mockPrisma('投訴建議');
  let called = 0;
  const result = await autoClassifyNewCase(prisma, T1, 'case-1', 'conv-1', async () => (called++, classifier()));
  assert.equal(result, null);
  assert.equal(called, 0);
  assert.equal(updates.length, 0);
});

test('工單沒有分類：依最新的顧客訊息分類，只在仍無分類時寫入、帶租戶條件', async () => {
  const { prisma, updates } = mockPrisma(null);
  assert.equal(await autoClassifyNewCase(prisma, T1, 'case-1', 'conv-1', classifier), '退換貨');
  assert.deepEqual(updates, [{ where: { id: 'case-1', tenantId: T1, category: null }, data: { category: '退換貨' } }]);
});

test('分類是空字串（舊路由可存入）：視為已處理，不呼叫 AI（寫回條件是 null，對不上只會白算）', async () => {
  const { prisma, updates } = mockPrisma('');
  let called = 0;
  assert.equal(await autoClassifyNewCase(prisma, T1, 'case-1', 'conv-1', async () => (called++, classifier())), null);
  assert.equal(called, 0);
  assert.equal(updates.length, 0);
});

test('沒有顧客文字訊息：不分類、不寫入', async () => {
  const updates: unknown[] = [];
  let called = 0;
  const prisma = {
    case: { findFirst: async () => ({ category: null }), updateMany: async (a: unknown) => (updates.push(a), { count: 1 }) },
    message: { findFirst: async () => ({ content: { imageUrl: 'x' } }) },
  } as never;
  assert.equal(await autoClassifyNewCase(prisma, T1, 'case-1', 'conv-1', async () => (called++, classifier())), null);
  assert.equal(called, 0);
  assert.equal(updates.length, 0);
});
