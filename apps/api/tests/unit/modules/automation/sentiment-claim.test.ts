/**
 * 情緒分析每則訊息最多一次（change outbox-event-delivery：automation-engine「情緒分析每則訊息最多一次」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ llm: 0 }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({ attemptKbAutoReply: async () => false }));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false, runAgentReply: async () => ({ handled: false }) }));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => {
    calls.llm += 1;
    // 讓出執行權：兩次處理同時進行時，都先通過 LLM 前的檢查
    await new Promise((r) => setTimeout(r, 5));
    return { sentiment: 'negative', score: -0.7, confidence: 0.8 };
  },
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({ deliverToChannel: async () => true }));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived } = await import('./automation-harness.js');

beforeEach(() => {
  calls.llm = 0;
});

function setup() {
  // botMode off：只測情緒分析，不做 AI 回覆
  const h = createHarness({ botConfig: { botMode: 'off' } });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  return { h, handle };
}

const negatives = (h: ReturnType<typeof createHarness>) => h.state.outbox.filter((o) => o.name === 'sentiment.negative');

test('同一則訊息處理兩次：只發出一個 sentiment.negative，第二次不呼叫 LLM', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await handle(event);
  await handle(event);

  assert.equal(negatives(h).length, 1);
  assert.equal(calls.llm, 1);
});

test('兩次處理同時進行：只有一次寫入結果並發出 sentiment.negative', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await Promise.all([handle(event), handle(event)]);

  assert.equal(calls.llm, 2);
  assert.equal(negatives(h).length, 1);
});
