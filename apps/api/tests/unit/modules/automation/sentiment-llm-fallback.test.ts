/**
 * 情緒分析的 LLM 失敗時改用關鍵字判斷（change outbox-event-delivery：automation-engine「情緒分析每則訊息最多一次」
 * 的 Scenario「Sentiment LLM fails」）。
 *
 * 用真的 analyzeSentiment()，只把它呼叫的 LLM（generateReply）換成丟錯，
 * 確認失敗沒有被當成「略過」，而是寫入關鍵字判斷的結果並認領。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));
vi.mock('#src/modules/ai/llm.service.js', () => ({
  generateReply: async () => {
    throw new Error('LLM timeout');
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({ attemptKbAutoReply: async () => false }));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false, runAgentReply: async () => ({ handled: false }) }));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({ deliverToChannel: async () => true }));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived, MESSAGE } = await import('./automation-harness.js');

test('Sentiment LLM fails：改用關鍵字判斷的結果，寫入並認領，處理照常完成', async () => {
  // botMode off：只測情緒分析，不做 AI 回覆
  const h = createHarness({ botConfig: { botMode: 'off' } });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  await handle(messageReceived({ messageContent: '服務太差' }));

  const message = h.state.messages.find((m) => m.id === MESSAGE)!;
  assert.deepEqual(message.metadata.sentiment, { sentiment: 'negative', score: -0.6, confidence: 0.5 });
  assert.ok(h.state.claims.includes(`sentiment|${MESSAGE}|`));
  // 關鍵字判斷的信心值 0.5，低於 0.6，不發出 sentiment.negative
  assert.equal(h.state.outbox.filter((o) => o.name === 'sentiment.negative').length, 0);
});
