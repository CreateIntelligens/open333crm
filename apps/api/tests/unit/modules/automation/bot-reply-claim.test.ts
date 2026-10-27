/**
 * 每則入站訊息最多一則機器人回覆（change outbox-event-delivery：automation-engine「每則入站訊息最多一則機器人回覆」）。
 *
 * agent 與 KB 的 LLM 換成假的；agent 寫入回覆用真的 persistAndDeliverAgentReply()，送出換成假的。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  delivered: [] as unknown[],
  agent: 0,
  kb: 0,
  agentMode: 'persist' as 'persist' | 'throw',
}));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));
vi.mock('#src/modules/ai/agent/agent.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/modules/ai/agent/agent.service.js')>();
  return {
    ...actual,
    isAgentEnabled: () => true,
    // LLM 換成固定的回覆，寫入與送出走真的 persistAndDeliverAgentReply()
    runAgentReply: async (prisma: unknown, input: { tenantId: string; conversationId: string; io: never; replyGuard: never }) => {
      calls.agent += 1;
      if (calls.agentMode === 'throw') throw new Error('LLM down');
      await actual.persistAndDeliverAgentReply(prisma as never, input.tenantId, input.conversationId, 'agent 回覆', 'run-1', input.io, {}, false, input.replyGuard);
      return { handled: true, runId: 'run-1' };
    },
  };
});
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({
  attemptKbAutoReply: async (
    _p: unknown,
    _io: unknown,
    _t: string,
    _c: string,
    _text: string,
    _d: unknown,
    guard: { persist(write: (tx: { message: { create(a: unknown): Promise<unknown> } }) => Promise<unknown>): Promise<unknown> },
  ) => {
    calls.kb += 1;
    const row = await guard.persist((tx) =>
      tx.message.create({ data: { senderType: 'BOT', contentType: 'text', content: { text: 'KB 回覆' } } }),
    );
    if (row) calls.delivered.push('KB 回覆');
    return row !== null;
  },
}));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
vi.mock('#src/modules/ai/deidentification.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareStoredMessageContent: async (_p: unknown, _t: string, content: unknown) => ({ content, metadata: {} }),
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    calls.delivered.push(payload);
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { persistAndDeliverAgentReply } = await import('#src/modules/ai/agent/agent.service.js');
const { createBotReplyGuard } = await import('#src/modules/automation/bot-reply-guard.js');
const { createHarness, messageReceived, MESSAGE, TENANT, CONVERSATION } = await import('./automation-harness.js');

beforeEach(() => {
  calls.delivered.length = 0;
  calls.agent = 0;
  calls.kb = 0;
  calls.agentMode = 'persist';
});

function setup() {
  const h = createHarness();
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  return { h, handle };
}

const botMessages = (h: ReturnType<typeof createHarness>) => h.state.messages.filter((m) => m.senderType === 'BOT');

test('同一則訊息處理兩次：客人只收到一則回覆，對話只有一則機器人回覆訊息', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await handle(event);
  await handle(event);

  assert.equal(calls.delivered.length, 1);
  assert.equal(botMessages(h).length, 1);
});

test('同一則訊息處理兩次，兩次都已呼叫 LLM：只有一次寫入並送出回覆', async () => {
  const h = createHarness();
  const reply = () =>
    persistAndDeliverAgentReply(h.adminPrisma as never, TENANT, CONVERSATION, 'agent 回覆', 'run-1', h.io as never, {}, false,
      createBotReplyGuard(h.tenantPrisma as never, h.adminPrisma as never, TENANT, MESSAGE));
  await Promise.all([reply(), reply()]);

  assert.equal(calls.delivered.length, 1);
  assert.equal(botMessages(h).length, 1);
  assert.equal(h.state.conversation.botRepliesCount, 1);
});

test('agent 失敗改由 KB 回覆：KB 的認領成功，客人收到 KB 的回覆', async () => {
  const { h, handle } = setup();
  calls.agentMode = 'throw';
  await handle(messageReceived());

  assert.equal(calls.kb, 1);
  assert.deepEqual(calls.delivered, ['KB 回覆']);
  assert.ok(h.state.claims.includes(`bot_reply|${MESSAGE}|`));
});

test('已認領就不呼叫 LLM：這則入站訊息已有 bot_reply 認領紀錄', async () => {
  const { h, handle } = setup();
  h.state.claims.push(`bot_reply|${MESSAGE}|`);
  await handle(messageReceived());

  assert.equal(calls.agent, 0);
  assert.equal(calls.kb, 0);
  assert.deepEqual(calls.delivered, []);
});

test('Claim transaction fails：bot_reply 認領的交易失敗時處理失敗，由佇列重試', async () => {
  const { h, handle } = setup();
  h.state.failClaimKind = 'bot_reply';
  await assert.rejects(handle(messageReceived()), /connection reset/);
  assert.deepEqual(calls.delivered, []);
  assert.equal(botMessages(h).length, 0);
});
