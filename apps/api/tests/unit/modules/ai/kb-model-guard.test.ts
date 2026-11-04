/**
 * 型號守門（issue #420，AUDIT KB-02，change fix-kb-model-guard-420）：
 * - bot-handoff-config「型號守門只攔截知識庫型號格式的型號」
 * - bot-handoff-config「知識庫追問用完或 AI 失敗時轉接真人」的型號守門 scenario
 *
 * 經過 workers 的 message.received 流程（setupAutomationWorker），KB 自動回覆用真的 attemptKbAutoReply；
 * LLM、向量檢索與送出換成假的（知識庫沒有相似文章，相似度 0），資料庫是 automation-harness 的假交易。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  delivered: [] as string[],
  llm: 0,
  llmError: null as Error | null,
  llmReply: '請問您想詢問哪一項服務呢？',
  prompts: [] as string[],
  knownKeys: new Set<string>() as ReadonlySet<string>,
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
  generateReply: async (_p: unknown, _t: string, _m: string, _ctx: string, opts?: { overrideSystemPrompt?: string }) => {
    calls.prompts.push(opts?.overrideSystemPrompt ?? '');
    calls.llm += 1;
    if (calls.llmError) throw calls.llmError;
    return calls.llmReply;
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
// 型號白名單由各測試設定（model-registry 從文章標題抽出；這裡直接給結果）
vi.mock('#src/modules/ai/model-registry.service.js', () => ({ getKnownModelKeys: async () => calls.knownKeys }));
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
  prepareStoredMessageContent: async (_p: unknown, _t: string, content: unknown) => ({ content, metadata: {} }),
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    calls.delivered.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { MODEL_GUIDE_SYSTEM_PROMPT } = await import('#src/modules/ai/llm.service.js');
const { createHarness, messageReceived, CONVERSATION } = await import('../automation/automation-harness.js');

const FAKE_HANDOFF = '已為您轉接客服人員';
/** 大同型號的白名單（主鍵 = 前綴 + 第 1 段） */
const TATUNG_KEYS = new Set(['TAC-11A', 'TAC-11KN', 'TAC-06L']);

beforeEach(() => {
  calls.delivered.length = 0;
  calls.llm = 0;
  calls.llmError = null;
  calls.llmReply = '請問您想詢問哪一項服務呢？';
  calls.prompts.length = 0;
  calls.knownKeys = TATUNG_KEYS;
  calls.evaluate.length = 0;
});

function setup(metadata: Record<string, unknown> = {}) {
  const h = createHarness({ botRepliesCount: 2, botConfig: { maxBotReplies: 20 }, metadata });
  const io = { to: () => ({ emit: () => {} }) };
  const handle = setupAutomationWorker(h.adminPrisma as never, io as never, h.tenantPrisma as never);
  return { h, handle };
}

function lastBotReply(h: ReturnType<typeof setup>['h']) {
  const bots = h.state.messages.filter((m) => m.senderType === 'BOT');
  return bots[bots.length - 1];
}

async function send(text: string, metadata: Record<string, unknown> = {}) {
  const ctx = setup(metadata);
  await ctx.handle(messageReceived({ messageContent: text }));
  return ctx;
}

// ── 型號守門只攔截知識庫型號格式的型號 ──────────────────────────────

test.each([
  ['我家 Wi-Fi 連不上怎麼辦'],
  ['請問可以寄 e-mail 給你們嗎'],
  ['我想買 T-shirt'],
  ['WI-FI 密碼要怎麼改'],
  ['wi-fi 一直斷線'],
])('一般英文詞不當成型號：%s → 走追問，不回型號查不到', async (text) => {
  const { h } = await send(text);
  const reply = lastBotReply(h);
  assert.equal(reply.metadata.replyKind, 'clarify');
  assert.equal(reply.metadata.modelGuard, undefined);
  assert.ok(!calls.prompts.includes(MODEL_GUIDE_SYSTEM_PROMPT), '沒有用型號引導的提示詞');
});

test('小寫型號視同大寫：前綴在白名單時照常守門，tac-11p → model_not_found', async () => {
  const { h } = await send('tac-11p 怎麼清洗');
  const reply = lastBotReply(h);
  assert.equal(reply.metadata.replyKind, 'model_not_found');
  const guard = reply.metadata.modelGuard as { unknownModel: string; relatedModels: string[] };
  assert.equal(guard.unknownModel, 'TAC-11P');
  assert.deepEqual(guard.relatedModels, ['TAC-11A', 'TAC-11KN']);
});

test('小寫的已知型號不守門：tac-11a → 走追問', async () => {
  const { h } = await send('tac-11a 怎麼清洗');
  assert.equal(lastBotReply(h).metadata.replyKind, 'clarify');
});

test('查無的型號仍引導選型號：TAC-11P → model_not_found，列出相近型號', async () => {
  calls.llmReply = '請問是 TAC-11A 還是 TAC-11KN 呢？';
  const { h } = await send('TAC-11P 怎麼清洗');
  const reply = lastBotReply(h);
  assert.equal(reply.metadata.replyKind, 'model_not_found');
  const guard = reply.metadata.modelGuard as { unknownModel: string; relatedModels: string[] };
  assert.equal(guard.unknownModel, 'TAC-11P');
  assert.deepEqual(guard.relatedModels, ['TAC-11A', 'TAC-11KN']);
  assert.equal(calls.prompts[0], MODEL_GUIDE_SYSTEM_PROMPT);
});

test('知識庫沒有型號文章時不守門：白名單空，TAC-11P → 走追問', async () => {
  calls.knownKeys = new Set();
  const { h } = await send('TAC-11P 怎麼清洗');
  const reply = lastBotReply(h);
  assert.equal(reply.metadata.replyKind, 'clarify');
  assert.equal(reply.metadata.modelGuard, undefined);
});

test('前綴不在白名單的編號不守門：訂單 AB-12345 → 走追問', async () => {
  const { h } = await send('我的訂單 AB-12345 還沒到');
  const reply = lastBotReply(h);
  assert.equal(reply.metadata.replyKind, 'clarify');
  assert.equal(reply.metadata.modelGuard, undefined);
});

// ── 守門回覆計入追問次數，用完時轉接真人 ───────────────────────────

test('型號守門回覆累加追問次數：次數 0 → 1，對話仍是 BOT_HANDLED', async () => {
  const { h } = await send('TAC-11P 怎麼清洗', { clarifyAttempts: 0 });
  assert.equal(lastBotReply(h).metadata.replyKind, 'model_not_found');
  assert.equal(h.state.conversation.metadata.clarifyAttempts, 1);
  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
});

test('型號守門時追問次數已用完：回「已為您轉接」並真的轉接，次數歸零', async () => {
  const { h } = await send('TAC-11P 怎麼清洗', { clarifyAttempts: 2 });

  assert.equal(calls.llm, 0, '用完時不再呼叫 LLM');
  assert.equal(calls.delivered.length, 1);
  assert.ok(calls.delivered[0].includes(FAKE_HANDOFF), calls.delivered[0]);
  assert.equal(lastBotReply(h).metadata.replyKind, 'clarify_handoff');
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.match(h.state.conversation.handoffReason ?? '', /追問次數已達上限/);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'SYSTEM').length, 1);
  const handoffs = h.state.outbox.filter((o) => o.name === 'conversation.handoff');
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].payload.conversationId, CONVERSATION);
  assert.equal(h.state.conversation.metadata.clarifyAttempts, 0);
});

test('客人一直提到查無的型號：第三則轉接真人', async () => {
  const { h, handle } = setup({ clarifyAttempts: 0 });
  const ids = ['b0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000c2'];
  await handle(messageReceived({ messageContent: 'TAC-11P 怎麼清洗' }));
  for (const id of ids) {
    h.state.messages.push({ id, senderType: 'CONTACT', contentType: 'text', content: { text: 'TAC-11P 啦' }, metadata: {} });
    await handle(messageReceived({ messageId: id, messageContent: 'TAC-11P 啦' }));
  }
  const kinds = h.state.messages.filter((m) => m.senderType === 'BOT').map((m) => m.metadata.replyKind);
  assert.deepEqual(kinds, ['model_not_found', 'model_not_found', 'clarify_handoff']);
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
});
