/**
 * 自動轉接讀取不合法的機器人設定（change validate-bot-config-and-action-params，bot-handoff-config
 * 「讀取機器人設定時不合法的值改用預設值」；issue #405）。
 *
 * 修正前 handoffKeywords 含空字串時，`text.includes('')` 恆為 true，每則訊息都轉接真人；
 * handoffMessage 空白時送出空的轉接訊息。走 message.received → checkAutoHandoff，摘要與送出換成假的。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { downRedis } from '#tests/support/llm-deps.js';

const calls = vi.hoisted(() => ({ delivered: [] as string[] }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.flow.js', () => ({
  attemptKbAutoReplyFlow: async () => ({ status: 'skipped', reason: 'kb_disabled' }),
}));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false }));
vi.mock('#src/modules/ai/ai.flow.js', () => ({
  analyzeSentimentFlow: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
  autoClassifyNewCaseFlow: async () => {},
  summarizeConversationFlow: async () => ({ summary: '摘要' }),
}));
vi.mock('#src/modules/ai/deidentification.service.js', () => ({
  prepareStoredMessageContent: async (_policy: unknown, content: unknown) => ({ content, metadata: {} }),
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    calls.delivered.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived } = await import('./automation-harness.js');

beforeEach(() => {
  calls.delivered.length = 0;
});

function setup(botConfig: Record<string, unknown>) {
  const h = createHarness({ botConfig });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never, downRedis);
  return { h, handle };
}

test('轉接關鍵字有空字串：一般訊息不轉接', async () => {
  const { h, handle } = setup({ handoffKeywords: ['', '真人'] });
  await handle(messageReceived({ messageContent: '請問營業時間' }));
  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.deepEqual(calls.delivered, []);
});

test('轉接關鍵字有空字串：含其他關鍵字的訊息照常轉接', async () => {
  const { h, handle } = setup({ handoffKeywords: ['', '真人'] });
  await handle(messageReceived({ messageContent: '我要真人' }));
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
});

test('轉接關鍵字含數字：不讓整個處理失敗，含其他關鍵字的訊息照常轉接', async () => {
  const { h, handle } = setup({ handoffKeywords: [123, '真人'] });
  await handle(messageReceived({ messageContent: '我要真人' }));
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
});

test('轉接訊息空白：客人收到預設轉接訊息', async () => {
  const { h, handle } = setup({ handoffKeywords: ['真人'], handoffMessage: '' });
  await handle(messageReceived({ messageContent: '我要真人' }));
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.deepEqual(calls.delivered, ['稍等，正在為您轉接客服人員']);
});
