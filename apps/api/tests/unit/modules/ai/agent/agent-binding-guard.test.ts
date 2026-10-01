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
const delivered: unknown[] = [];
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_db: unknown, _conversationId: string, payload: unknown) => {
    delivered.push(payload);
  },
}));
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

test('runAgentReply 送出時：寫進資料庫與送到渠道的都是固定說明，訊息標記 bindingCodeBlocked', async () => {
  const { runAgentReply } = await import('#src/modules/ai/agent/agent.service.js');
  const created: Array<{ content: { text: string }; metadata: Record<string, unknown> }> = [];
  const tx = {
    conversation: { updateMany: async () => ({ count: 1 }) },
    message: {
      create: async (args: { data: { content: { text: string }; metadata: Record<string, unknown> } }) => {
        created.push(args.data);
        return { id: 'm1', metadata: args.data.metadata };
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    conversation: { ...tx.conversation, findFirst: async () => ({ id: 'c1' }) },
    agentRun: { create: async () => ({ id: 'run2', expiresAt: new Date() }), updateMany: async () => ({ count: 1 }) },
    tenantSettings: { findFirst: async () => ({ identityBinding: { enabled: true, bindKeywords: ['綁定帳號'] } }) },
    message: { ...tx.message, findMany: async () => [] },
  } as never;
  const io = { to: () => ({ emit: () => {} }) } as never;
  delivered.length = 0;
  await runAgentReply(prisma, { tenantId: 'agent-guard-tenant-2', conversationId: 'c1', userMessage: 'x', deliver: true, io });
  const expected = '如需綁定其他帳號，請直接傳送「綁定帳號」，系統會提供專屬的綁定連結與代碼。';
  assert.equal(created.length, 1);
  assert.equal(created[0]!.metadata.bindingCodeBlocked, true);
  assert.equal(created[0]!.content.text, expected);
  assert.equal(delivered.length, 1);
  assert.equal((delivered[0] as { content: { text: string } }).content.text, expected, '送到渠道的與寫進資料庫的相同');
});
