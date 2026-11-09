/**
 * 未遮罩的進站訊息不交給模型（issue #466，change fix-deid-inbound-fallback-466：
 * bot-handoff-config「未遮罩的進站訊息不交給 AI，轉接真人」）。
 *
 * 經過 workers 的 message.received 流程（setupAutomationWorker），情緒分析、關鍵字讓步與轉接都是真的；
 * 只換掉模型供應商、聊天設定、Redis 額度與送出渠道。資料庫是 automation-harness 的假交易。
 * 完整的進站到轉接見 tests/feature/modules/webhook/inbound-deidentification-fallback.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ generate: 0, toolTurns: 0, delivered: [] as string[] }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));
vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({ KB_AUTO_REPLY_ENABLED: true, AGENTIC_LLM_ENABLED: true, AGENT_MAX_TURNS: 3, AGENT_MAX_TOOL_CALLS: 3, AGENT_TIMEOUT_MS: 5_000, AGENT_MAX_TOTAL_TOKENS: 10_000 }),
}));
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'test',
    label: 'test',
    async generate() {
      calls.generate += 1;
      return { text: '{"sentiment":"neutral","score":0,"confidence":0.9}' };
    },
    async generateToolTurn() {
      calls.toolTurns += 1;
      return { text: 'AI 回覆', toolCalls: [] };
    },
  }),
}));
vi.mock('#src/modules/trial/token-quota.service.js', () => ({ isMonthlyTokenExceeded: async () => false }));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ provider: 'test', model: 'test-model', temperature: 0.2, maxTokens: 500, clarifyThreshold: 0.5, clarifyMaxAttempts: 2 }),
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    calls.delivered.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived, MESSAGE } = await import('./automation-harness.js');

beforeEach(() => {
  calls.generate = 0;
  calls.toolTurns = 0;
  calls.delivered.length = 0;
  // 去識別化服務已恢復正常：模型的包裝層照常遮罩，仍不可把沒有遮罩副本的訊息送去模型
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (!String(input).includes('2md.aiurl.tw')) throw new Error(`測試不可打外部服務：${input}`);
    const { text } = JSON.parse(String(init?.body)) as { text: string };
    return Response.json({ code: 200, data: { status: 'ok', text } });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(overrides: Parameters<typeof createHarness>[0] = {}) {
  const h = createHarness({ privacyEnabled: true, ...overrides });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  return { h, handle };
}

test('未遮罩的訊息命中關鍵字規則', async () => {
  const { h, handle } = setup({
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
  await handle(messageReceived({ messageContent: '營業時間', privacyUnmasked: true }));

  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 0);
  assert.equal(calls.toolTurns, 0);
  assert.equal(calls.generate, 0, '情緒分析也沒有呼叫模型');
});

test('未遮罩的訊息的情緒分析', async () => {
  const { h, handle } = setup({ botConfig: { botMode: 'off' } });
  await handle(messageReceived({ messageContent: '太爛了', privacyUnmasked: true }));

  const message = h.state.messages.find((m) => m.id === MESSAGE)!;
  assert.equal((message.metadata.sentiment as { sentiment: string }).sentiment, 'negative');
  assert.equal(calls.generate, 0, '模型供應商沒有被呼叫');
});

test('去識別化服務無法使用時客人要求轉接真人', async () => {
  // 2md 一直回 503：轉接的系統訊息不可因遮罩失敗而寫不進去，對話仍要轉給真人
  let deidRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (!String(input).includes('2md.aiurl.tw')) throw new Error(`測試不可打外部服務：${input}`);
    deidRequests += 1;
    return new Response('upstream unavailable', { status: 503 });
  }));
  const { h, handle } = setup({ botConfig: { handoffKeywords: ['真人'] } });
  // 處理失敗會讓佇列一直重試，對話永遠轉不出去
  await assert.doesNotReject(handle(messageReceived({ messageContent: '我要找真人 0912345678', privacyUnmasked: true })));

  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.equal(h.state.conversation.handoffReason, '客戶要求轉接真人 (關鍵字: 真人)');
  const system = h.state.messages.filter((m) => m.senderType === 'SYSTEM');
  assert.equal(system.length, 1);
  assert.deepEqual(system[0]!.content, { text: '自動轉接人工客服：客戶要求轉接真人 (關鍵字: 真人)' });
  assert.equal((system[0]!.metadata.privacy as { mode: string }).mode, 'system_fixed');
  assert.ok(!JSON.stringify(system[0]).includes('0912345678'), '系統訊息不含客人的原文');
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
  assert.ok(deidRequests > 0, '有先嘗試遮罩含摘要的系統訊息');
  assert.equal(calls.toolTurns, 0);
});
