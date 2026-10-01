/** AI 回覆含綁定代碼時，runAgentReply 回傳與送出的都是固定說明（change add-cross-channel-one-id，防 AI 偽造代碼） */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('#src/modules/ai/agent/runner.js', () => ({
  runAgent: async () => ({
    status: 'completed',
    text: '請選擇要綁定的帳號…代碼 BIND-5W5PZ472M9',
    finalText: '',
    turns: 1,
    toolCalls: 0,
  }),
}));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ provider: 'gemini', model: 'm', temperature: 0, maxTokens: 10 }),
}));
vi.mock('#src/modules/ai/ai-key.service.js', () => ({ resolveGeminiKey: async () => ({ key: 'k', source: 'tenant' }) }));
vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({ AGENT_WIKI_AUTO_PUBLISH: false, AGENT_MAX_TURNS: 1, AGENT_MAX_TOOL_CALLS: 1, AGENT_TIMEOUT_MS: 1000, AGENT_MAX_TOTAL_TOKENS: 1000 }),
}));

test('runAgentReply：AI 回覆含代碼 → 換成引導傳送綁定關鍵字的固定說明', async () => {
  const { runAgentReply } = await import('#src/modules/ai/agent/agent.service.js');
  const prisma = {
    agentRun: { create: async () => ({ id: 'run1', expiresAt: new Date() }), updateMany: async () => ({ count: 1 }) },
    tenantSettings: { findFirst: async () => ({ identityBinding: { enabled: true, bindKeywords: ['綁定帳號'] } }) },
  } as never;
  const out = await runAgentReply(prisma, { tenantId: 'agent-guard-tenant', userMessage: '綁定帳號綁定帳號' });
  assert.doesNotMatch(out.text, /BIND-/);
  assert.match(out.text, /「綁定帳號」/);
});
