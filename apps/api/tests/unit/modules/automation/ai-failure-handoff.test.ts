/**
 * AI 與知識庫回覆都因錯誤失敗時轉接真人（issue #445，change handoff-on-ai-reply-failure-445：
 * bot-handoff-config「AI 與知識庫回覆都因錯誤失敗時轉接真人」「正常不回覆時不轉接」「AI 失敗的轉接每則訊息最多一次」）。
 *
 * 經過 workers 的 message.received 流程（setupAutomationWorker），agent 回覆（runAgentReplyFlow）、
 * 知識庫自動回覆（attemptKbAutoReply）與去識別化服務都是真的。只換掉最底層的邊界：
 * HTTP（fetch：2md 去識別化與 embedding 服務）、模型供應商、LLM、向量檢索、Redis 額度與送出渠道。
 * 資料庫是 automation-harness 的假交易（丟錯時還原）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { downRedis } from '#tests/support/llm-deps.js';

const calls = vi.hoisted(() => ({
  delivered: [] as string[],
  kbEnabled: true,
  /** 2md 去識別化服務回 503 */
  deidDown: false,
  deidRequests: 0,
  /** embedding 服務回的狀態碼；200 時回一組向量 */
  embedStatus: 200,
  embedBody: '',
  /** agent 的模型供應商丟錯 */
  agentProviderFails: false,
  agentTurns: 0,
  kbLlm: 0,
  searchResults: [] as Array<{ id: string; title: string; content: string; summary: string; similarity: number }>,
}));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));
vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({
    KB_AUTO_REPLY_ENABLED: calls.kbEnabled,
    AGENTIC_LLM_ENABLED: true,
    AGENT_WIKI_AUTO_PUBLISH: false,
    AGENT_MAX_TURNS: 3,
    AGENT_MAX_TOOL_CALLS: 3,
    AGENT_TIMEOUT_MS: 5_000,
    AGENT_MAX_TOTAL_TOKENS: 10_000,
  }),
}));
// 模型供應商（LLM 邊界）：agent 的 generateToolTurn
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'test',
    label: 'test',
    async generate() {
      return { text: 'unused' };
    },
    async generateToolTurn() {
      calls.agentTurns += 1;
      if (calls.agentProviderFails) throw new Error('provider 503');
      return { text: '2', toolCalls: [] };
    },
  }),
}));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({
    provider: 'test',
    model: 'test-model',
    temperature: 0.2,
    maxTokens: 500,
    clarifyThreshold: 0.5,
    clarifyMaxAttempts: 2,
  }),
}));
vi.mock('#src/modules/settings/embedding-settings.service.js', () => ({
  getEmbeddingSettings: async () => ({ baseUrl: 'http://embed.test', model: 'bge-m3', topK: 3, threshold: 0.5 }),
}));
// 向量檢索是資料庫的 raw query；向量化（readEmbeddingInputs、embedText）用真的
vi.mock('#src/modules/embedding/embedding.service.js', async (orig) => ({
  ...(await orig<object>()),
  searchSimilarArticles: async () => calls.searchResults,
}));
vi.mock('#src/modules/ai/llm.flow.js', async (orig) => ({
  ...(await orig<object>()),
  generateReply: async () => {
    calls.kbLlm += 1;
    return '我們每天 9 點開門';
  },
}));
vi.mock('#src/modules/ai/model-registry.service.js', () => ({ getKnownModelKeys: async () => new Set<string>() }));
vi.mock('#src/modules/ai/other-channel-context.js', async (orig) => ({
  ...(await orig<object>()),
  loadOtherChannelContext: async () => '',
}));
vi.mock('#src/modules/identity-binding/ai-guard.js', async (orig) => ({
  ...(await orig<object>()),
  guardAiReplyForTenant: async (_p: unknown, _t: string, text: string) => ({ text, blocked: false }),
}));
vi.mock('#src/modules/ai/ai.flow.js', () => ({
  analyzeSentimentFlow: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
  autoClassifyNewCaseFlow: async () => {},
  summarizeConversationFlow: async () => ({ summary: '' }),
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    calls.delivered.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived, TENANT, CHANNEL, CONVERSATION, MESSAGE } = await import('./automation-harness.js');

const HANDOFF_MESSAGE = '稍等，正在為您轉接客服人員';

/** HTTP 邊界：2md 去識別化服務與 embedding 服務 */
async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('2md.aiurl.tw')) {
    calls.deidRequests += 1;
    if (calls.deidDown) return new Response('upstream unavailable', { status: 503 });
    const { text } = JSON.parse(String(init?.body)) as { text: string };
    return new Response(JSON.stringify({ code: 200, data: { status: 'ok', text } }), { status: 200 });
  }
  if (url.startsWith('http://embed.test/')) {
    if (calls.embedStatus !== 200) return new Response(calls.embedBody, { status: calls.embedStatus });
    return new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), { status: 200 });
  }
  throw new Error(`測試不可打外部服務：${url}`);
}

beforeEach(() => {
  calls.delivered.length = 0;
  calls.kbEnabled = true;
  calls.deidDown = false;
  calls.deidRequests = 0;
  calls.embedStatus = 200;
  calls.embedBody = '';
  calls.agentProviderFails = false;
  calls.agentTurns = 0;
  calls.kbLlm = 0;
  calls.searchResults = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(overrides: Parameters<typeof createHarness>[0] = {}) {
  const h = createHarness({
    botRepliesCount: 1,
    ...overrides,
    botConfig: { maxBotReplies: 20, handoffMessage: HANDOFF_MESSAGE, ...overrides.botConfig },
  });
  const emitted: Array<{ rooms: string[]; name: string; data: Record<string, unknown> }> = [];
  const io = {
    to: (rooms: string | string[]) => ({
      emit: (name: string, data: Record<string, unknown>) => {
        emitted.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], name, data });
      },
    }),
  };
  const handle = setupAutomationWorker(h.adminPrisma as never, io as never, h.tenantPrisma as never, downRedis);
  return { h, handle, emitted };
}

function handoffEvents(h: ReturnType<typeof setup>['h']) {
  return h.state.outbox.filter((o) => o.name === 'conversation.handoff');
}

function assertNotHandedOff(h: ReturnType<typeof setup>['h']) {
  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.equal(handoffEvents(h).length, 0);
  assert.ok(!calls.delivered.includes(HANDOFF_MESSAGE), `沒有送出轉接訊息：${calls.delivered.join(' | ')}`);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'SYSTEM').length, 0);
}

test('去識別化服務失敗', async () => {
  calls.deidDown = true;
  const { h, handle, emitted } = setup({ privacyEnabled: true });
  await handle(messageReceived({ messageContent: '1+1等於幾' }));

  assert.ok(calls.deidRequests > 0, '真的呼叫了去識別化服務');
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.equal(h.state.conversation.handoffReason, 'AI 暫時無法回覆（去識別化服務無法使用）');
  const system = h.state.messages.filter((m) => m.senderType === 'SYSTEM');
  assert.equal(system.length, 1, '一則系統訊息');
  assert.equal(system[0].metadata.type, 'auto_handoff');
  assert.equal(system[0].metadata.source, 'ai_reply_failed');
  assert.deepEqual(system[0].content, { text: '自動轉接人工客服：AI 暫時無法回覆（去識別化服務無法使用）' });
  // 開啟遮罩的租戶：模型讀的遮罩副本就是固定文字，沒有呼叫 2md
  assert.deepEqual((system[0].metadata.privacy as { maskedContent: unknown }).maskedContent, system[0].content);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'BOT').length, 0, '沒有機器人回覆');
  const events = handoffEvents(h);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.conversationId, CONVERSATION);
  assert.equal(events[0].payload.reason, 'AI 暫時無法回覆（去識別化服務無法使用）');
  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
  // 客服即時看到：conversation.updated 推到渠道房間
  const updated = emitted.filter((e) => e.name === 'conversation.updated');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].data.status, 'AGENT_HANDLED');
  assert.ok(updated[0].rooms.includes(`tenant:${TENANT}:channel:${CHANNEL}`), JSON.stringify(updated[0].rooms));
});

test('個資保護設定讀取失敗時仍轉接（PR #450 審查）', async () => {
  // 讀平台設定失敗：agent 與知識庫都丟 AI_PRIVACY_POLICY_UNAVAILABLE，轉接本身不可再因同一個讀取失敗而中止
  const { h, handle } = setup();
  h.state.failPrivacyRead = true;
  await handle(messageReceived({ messageContent: '你們幾點開門' }));

  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.equal(h.state.conversation.handoffReason, 'AI 暫時無法回覆（個資保護設定無法讀取）');
  const system = h.state.messages.filter((m) => m.senderType === 'SYSTEM');
  assert.equal(system.length, 1);
  assert.equal(system[0].metadata.source, 'ai_reply_failed');
  assert.equal(handoffEvents(h).length, 1);
  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
});

test('其他錯誤', async () => {
  calls.agentProviderFails = true;
  calls.embedStatus = 500;
  calls.embedBody = 'model crashed at http://10.0.0.5:11434';
  const { h, handle } = setup();
  await handle(messageReceived({ messageContent: '你們幾點開門' }));

  assert.equal(calls.agentTurns, 1, 'agent 呼叫了模型供應商');
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.equal(h.state.conversation.handoffReason, 'AI 暫時無法回覆（AI 服務發生錯誤）');
  const system = h.state.messages.filter((m) => m.senderType === 'SYSTEM');
  assert.equal(system.length, 1);
  const serialized = JSON.stringify(system[0]) + h.state.conversation.handoffReason;
  assert.ok(!serialized.includes('10.0.0.5') && !serialized.includes('model crashed'), serialized);
  assert.equal(handoffEvents(h).length, 1);
  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
});

test('agent 失敗但知識庫回覆成功', async () => {
  calls.agentProviderFails = true;
  calls.searchResults = [{ id: 'a1', title: '營業時間', content: '每天 9 點開門', summary: '', similarity: 0.92 }];
  const { h, handle } = setup();
  await handle(messageReceived({ messageContent: '你們幾點開門' }));

  assert.equal(calls.agentTurns, 1);
  assert.equal(calls.kbLlm, 1);
  assert.equal(calls.delivered.length, 1);
  assert.ok(calls.delivered[0].includes('我們每天 9 點開門'), calls.delivered[0]);
  assertNotHandedOff(h);
});

test('關鍵字規則讓步', async () => {
  calls.deidDown = true;
  const { h, handle } = setup({
    privacyEnabled: true,
    automationRules: [
      {
        id: 'r1',
        name: '營業時間',
        priority: 0,
        stopOnMatch: false,
        isActive: true,
        trigger: { type: 'keyword.matched', keywords: ['營業時間'] },
        conditions: { all: [] },
        actions: [{ type: 'send_message', params: { text: '每天 9 點開門' } }],
      },
    ],
  });
  await handle(messageReceived({ messageContent: '營業時間' }));

  assertNotHandedOff(h);
  assert.equal(calls.agentTurns, 0);
});

test('botMode 關閉', async () => {
  calls.deidDown = true;
  const { h, handle } = setup({ privacyEnabled: true, botConfig: { botMode: 'off' } });
  await handle(messageReceived({ messageContent: '1+1等於幾' }));

  assertNotHandedOff(h);
});

test('知識庫自動回覆停用', async () => {
  calls.deidDown = true;
  calls.kbEnabled = false;
  const { h, handle } = setup({ privacyEnabled: true });
  await handle(messageReceived({ messageContent: '1+1等於幾' }));

  assert.ok(calls.deidRequests > 0, 'agent 因去識別化服務失敗');
  assertNotHandedOff(h);
});

test('這則訊息已有機器人回覆', async () => {
  calls.deidDown = true;
  const { h, handle } = setup({ privacyEnabled: true });
  h.state.claims.push(h.claimKey({ kind: 'bot_reply', sourceId: MESSAGE }));
  await handle(messageReceived({ messageContent: '1+1等於幾' }));

  assertNotHandedOff(h);
  assert.equal(calls.deidRequests, 0, '不再呼叫 AI');
});

test('同一則訊息處理兩次', async () => {
  calls.deidDown = true;
  const { h, handle } = setup({ privacyEnabled: true });
  const event = messageReceived({ messageContent: '1+1等於幾' });
  await handle(event);
  await handle(event);

  assert.equal(h.state.messages.filter((m) => m.senderType === 'SYSTEM').length, 1);
  assert.equal(handoffEvents(h).length, 1);
  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
});

test('寫入系統訊息失敗', async () => {
  calls.deidDown = true;
  const { h, handle } = setup({ privacyEnabled: true });
  h.state.failSystemMessage = true;
  const event = messageReceived({ messageContent: '1+1等於幾' });
  await assert.rejects(handle(event), /system message write failed/);

  assertNotHandedOff(h);
  assert.equal(calls.delivered.length, 0);

  // 佇列重試：轉接一次
  h.state.failSystemMessage = false;
  await handle(event);
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.equal(handoffEvents(h).length, 1);
  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
});
