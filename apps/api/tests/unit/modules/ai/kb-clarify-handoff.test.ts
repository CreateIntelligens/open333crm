/**
 * 知識庫自動回覆說「已為您轉接客服人員」時真的轉接（issue #419，change fix-kb-clarify-handoff-419：
 * bot-handoff-config「知識庫追問用完或 AI 失敗時轉接真人」）。
 *
 * 經過 workers 的 message.received 流程（setupAutomationWorker），KB 自動回覆用真的 attemptKbAutoReply；
 * LLM、向量檢索與送出換成假的，資料庫是 automation-harness 的假交易（丟錯時還原）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  delivered: [] as string[],
  llm: 0,
  llmError: null as Error | null,
  evaluate: [] as Array<Record<string, unknown>>,
}));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(name: string, data: { context?: Record<string, unknown> }) {
      if (name === 'automation:evaluate' && data.context) calls.evaluate.push(data.context);
    }
  },
}));
vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({ KB_AUTO_REPLY_ENABLED: true }),
}));
vi.mock('#src/modules/ai/llm.service.js', async (orig) => ({
  ...(await orig<object>()),
  generateReply: async () => {
    calls.llm += 1;
    if (calls.llmError) throw calls.llmError;
    return '請問您想詢問哪一項服務呢？';
  },
}));
// 知識庫沒有能回答的文章：一律走追問
vi.mock('#src/modules/embedding/embedding.service.js', () => ({
  generateEmbedding: async () => [0.1],
  searchSimilarArticles: async () => [],
}));
vi.mock('#src/modules/settings/embedding-settings.service.js', () => ({ getEmbeddingSettings: async () => ({ topK: 3, threshold: 0.5 }) }));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ clarifyThreshold: 0.5, clarifyMaxAttempts: 2 }),
}));
vi.mock('#src/modules/ai/model-registry.service.js', () => ({ getKnownModelKeys: async () => new Set<string>() }));
vi.mock('#src/modules/ai/other-channel-context.js', () => ({ loadOtherChannelContext: async () => '' }));
vi.mock('#src/modules/identity-binding/ai-guard.js', async (orig) => ({
  ...(await orig<object>()),
  guardAiReplyForTenant: async (_p: unknown, _t: string, text: string) => ({ text, blocked: false }),
}));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false, runAgentReply: async () => ({ handled: false }) }));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
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
const { AppError } = await import('#src/shared/utils/response.js');
const { createHarness, messageReceived, TENANT, CHANNEL, CONVERSATION } = await import('../automation/automation-harness.js');

const FAKE_HANDOFF = '已為您轉接客服人員';

beforeEach(() => {
  calls.delivered.length = 0;
  calls.llm = 0;
  calls.llmError = null;
  calls.evaluate.length = 0;
});

function setup(metadata: Record<string, unknown> = {}) {
  // 機器人回覆次數遠低於 maxBotReplies，所以不是次數上限觸發的轉接
  const h = createHarness({ botRepliesCount: 2, botConfig: { maxBotReplies: 20 }, metadata });
  const emitted: Array<{ rooms: string[]; name: string; data: Record<string, unknown> }> = [];
  const io = {
    to: (rooms: string | string[]) => ({
      emit: (name: string, data: Record<string, unknown>) => {
        emitted.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], name, data });
      },
    }),
  };
  const handle = setupAutomationWorker(h.adminPrisma as never, io as never, h.tenantPrisma as never);
  return { h, handle, emitted };
}

function assertHandedOff(h: ReturnType<typeof setup>['h'], emitted: ReturnType<typeof setup>['emitted'], reasonPattern: RegExp) {
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.match(h.state.conversation.handoffReason ?? '', reasonPattern);
  const system = h.state.messages.filter((m) => m.senderType === 'SYSTEM');
  assert.equal(system.length, 1, '寫入一則系統訊息');
  assert.equal(system[0].metadata.type, 'auto_handoff');
  // 客服收到：發出 conversation.handoff（站內通知），並推播到渠道房間，不推到 tenant 房間
  const handoffEvents = h.state.outbox.filter((o) => o.name === 'conversation.handoff');
  assert.equal(handoffEvents.length, 1);
  assert.equal(handoffEvents[0].payload.conversationId, CONVERSATION);
  const updated = emitted.filter((e) => e.name === 'conversation.updated');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].data.status, 'AGENT_HANDLED');
  assert.ok(updated[0].rooms.includes(`tenant:${TENANT}:channel:${CHANNEL}`), JSON.stringify(updated[0].rooms));
  assert.ok(!updated[0].rooms.includes(`tenant:${TENANT}`), '不推到 tenant 房間');
  const systemPush = emitted.filter((e) => e.name === 'message.new' && (e.data.message as { senderType: string }).senderType === 'SYSTEM');
  assert.equal(systemPush.length, 1);
  assert.ok(systemPush[0].rooms.includes(`tenant:${TENANT}:channel:${CHANNEL}`));
}

test('追問次數用完：對話轉真人、寫入轉真人原因與系統訊息、客服收到', async () => {
  const { h, handle, emitted } = setup({ clarifyAttempts: 2 });
  await handle(messageReceived({ messageContent: '喂？有人嗎' }));

  assert.equal(calls.llm, 0, '追問用完不再呼叫 LLM');
  assert.equal(calls.delivered.length, 1);
  assert.ok(calls.delivered[0].includes(FAKE_HANDOFF), calls.delivered[0]);
  assertHandedOff(h, emitted, /追問/);
  // 追問次數歸零：客服交回 Bot 後重新計算，不會一交回就再轉接
  assert.equal(h.state.conversation.metadata.clarifyAttempts, 0);
});

test('LLM 呼叫失敗（月額度用完）：照樣真的轉接，原因寫月額度', async () => {
  calls.llmError = new AppError('已達方案 AI 月額度上限', 'PLAN_LIMIT_EXCEEDED', 403, { limitKey: 'monthlyTokens' });
  const { h, handle, emitted } = setup({ clarifyAttempts: 0 });
  await handle(messageReceived({ messageContent: '你們幾點開門' }));

  assert.equal(calls.llm, 1);
  assert.equal(calls.delivered.length, 1);
  assert.ok(calls.delivered[0].includes(FAKE_HANDOFF), calls.delivered[0]);
  assertHandedOff(h, emitted, /月額度/);
});

test('LLM 呼叫失敗（其他錯誤）：照樣真的轉接', async () => {
  calls.llmError = new Error('Gemini 500');
  const { h, handle, emitted } = setup({ clarifyAttempts: 0 });
  await handle(messageReceived({ messageContent: '你們幾點開門' }));

  assertHandedOff(h, emitted, /AI/);
});

test('轉接後客人再傳訊息：不會再收到同一句「已為您轉接」', async () => {
  const { h, handle } = setup({ clarifyAttempts: 2 });
  await handle(messageReceived({ messageContent: '喂？有人嗎' }));
  assert.equal(calls.delivered.length, 1);

  h.state.messages.push({ id: 'b0000000-0000-0000-0000-0000000000b2', senderType: 'CONTACT', contentType: 'text', content: { text: '到底有沒有人' }, metadata: {} });
  await handle(messageReceived({ messageId: 'b0000000-0000-0000-0000-0000000000b2', messageContent: '到底有沒有人' }));

  assert.equal(calls.delivered.length, 1, '第二則訊息沒有機器人回覆');
  assert.equal(h.state.messages.filter((m) => m.senderType === 'BOT').length, 1);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
});

test('同一則訊息處理兩次：只轉接一次、只送出一則轉接訊息', async () => {
  const { h, handle } = setup({ clarifyAttempts: 2 });
  const event = messageReceived({ messageContent: '喂？有人嗎' });
  await handle(event);
  await handle(event);

  assert.equal(calls.delivered.length, 1);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'SYSTEM').length, 1);
});

test('寫入系統訊息失敗：對話仍是 BOT_HANDLED，不送出轉接訊息，交給佇列重試', async () => {
  const { h, handle } = setup({ clarifyAttempts: 2 });
  h.state.failSystemMessage = true;
  await assert.rejects(handle(messageReceived({ messageContent: '喂？有人嗎' })));

  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.equal(calls.delivered.length, 0);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'BOT').length, 0);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 0);
});

test('還沒用完追問次數：照常追問，不轉接', async () => {
  const { h, handle } = setup({ clarifyAttempts: 1 });
  await handle(messageReceived({ messageContent: '還是不懂你們幾點開門' }));

  assert.equal(calls.llm, 1);
  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.equal(h.state.conversation.metadata.clarifyAttempts, 2);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 0);
});

test('轉接後客人傳送關鍵字：照樣交給關鍵字規則評估，KB 不回覆', async () => {
  const { h, handle } = setup({ clarifyAttempts: 2 });
  await handle(messageReceived({ messageContent: '喂？有人嗎' }));
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  // 轉接時已寫一則「已為您轉接」的機器人回覆
  const botRepliesAfterHandoff = h.state.messages.filter((m) => m.senderType === 'BOT').length;

  h.state.messages.push({ id: 'b0000000-0000-0000-0000-0000000000b3', senderType: 'CONTACT', contentType: 'text', content: { text: '營業時間' }, metadata: {} });
  await handle(messageReceived({ messageId: 'b0000000-0000-0000-0000-0000000000b3', messageContent: '營業時間' }));

  // workers 依 automation:evaluate 比對關鍵字規則並執行，不看對話狀態
  const second = calls.evaluate.filter((c) => c.messageId === 'b0000000-0000-0000-0000-0000000000b3');
  assert.equal(second.length, 1);
  assert.equal(second[0].messageContent, '營業時間');
  assert.equal(h.state.messages.filter((m) => m.senderType === 'BOT').length, botRepliesAfterHandoff, 'KB 不再回覆');
  assert.equal(calls.llm, 0, '轉接後不再呼叫模型');
});
