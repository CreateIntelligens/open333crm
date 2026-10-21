/**
 * 自動轉接每次只發生一次（change outbox-event-delivery：bot-handoff-config「自動轉接每次只發生一次」）。
 *
 * 摘要、送出與佇列換成假的；資料庫是 automation-harness 的假交易（丟錯時還原）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ delivered: [] as string[], evaluate: 0 }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(name: string) {
      if (name === 'automation:evaluate') calls.evaluate += 1;
    }
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({ attemptKbAutoReply: async () => false }));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false, runAgentReply: async () => ({ handled: false }) }));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({
  // 讓出執行權：兩次處理同時進行時，都先讀到 BOT_HANDLED 才進交易
  summarizeConversation: async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { summary: '摘要' };
  },
}));
vi.mock('#src/modules/ai/deidentification.service.js', () => ({
  prepareStoredMessageContent: async (_p: unknown, _t: string, content: unknown) => ({ content, metadata: {} }),
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    calls.delivered.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived } = await import('./automation-harness.js');

const HANDOFF_MESSAGE = '稍等，正在為您轉接客服人員';

beforeEach(() => {
  calls.delivered.length = 0;
  calls.evaluate = 0;
});

function setup() {
  // 機器人已回覆 5 次，達到上限：下一則訊息觸發自動轉接
  const h = createHarness({ botRepliesCount: 5 });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  return { h, handle };
}

test('同一則訊息處理兩次：客人只收到一則轉接訊息，只發出一個 conversation.handoff', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await handle(event);
  await handle(event);

  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
  assert.deepEqual(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
});

test('兩次處理同時進行：只有一個處理送出轉接訊息並發出 conversation.handoff', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await Promise.all([handle(event), handle({ ...event, id: crypto.randomUUID() })]);

  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'SYSTEM').length, 1);
});

test('寫入系統訊息失敗：對話仍是 BOT_HANDLED，不送出轉接訊息', async () => {
  const { h, handle } = setup();
  h.state.failSystemMessage = true;
  await handle(messageReceived());

  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.deepEqual(calls.delivered, []);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 0);
});
