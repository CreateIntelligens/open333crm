/**
 * 兩條 AI 回覆路徑（KB 自動回覆、Agent 模式）都把其他渠道的近期訊息送進模型
 * （change add-email-identity-merge，spec ai-cross-channel-context「歸戶後在另一個渠道發問」）。
 * 讀取內容本身由 feature 測試 other-channel-context.test.ts 驗證，這裡只驗證接線。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const OTHER = '以下是同一位顧客最近在其他渠道的訊息…\n[LINE 2 天前] 顧客：冷氣漏水怎麼處理';
const loadCalls: unknown[][] = [];
vi.mock('#src/modules/ai/other-channel-context.js', async (orig) => ({
  ...(await orig<object>()),
  loadOtherChannelContext: async (...args: unknown[]) => {
    loadCalls.push(args);
    return OTHER;
  },
}));

const generateReplyOptions: Array<Record<string, unknown>> = [];
vi.mock('#src/modules/ai/llm.service.js', async (orig) => ({
  ...(await orig<object>()),
  generateReply: async (_db: unknown, _tenantId: string, _msg: string, _kb: string, options: Record<string, unknown>) => {
    generateReplyOptions.push(options);
    return '回覆';
  },
}));
vi.mock('#src/modules/embedding/embedding.service.js', () => ({
  generateEmbedding: async () => [0.1],
  searchSimilarArticles: async () => [{ id: 'kb1', title: '漏水', content: '先關電源', summary: '', similarity: 0.9 }],
}));
vi.mock('#src/modules/settings/embedding-settings.service.js', () => ({ getEmbeddingSettings: async () => ({ topK: 3, threshold: 0.5 }) }));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ provider: 'gemini', model: 'm', temperature: 0, maxTokens: 10, clarifyThreshold: 0.5, clarifyMaxAttempts: 2 }),
}));
vi.mock('#src/modules/ai/model-registry.service.js', () => ({ getKnownModelKeys: async () => [] }));
vi.mock('#src/modules/ai/ai-key.service.js', () => ({ resolveGeminiKey: async () => ({ key: 'k', source: 'tenant' }) }));
const agentInputs: Array<{ systemPrompt: string }> = [];
vi.mock('#src/modules/ai/agent/runner.js', () => ({
  runAgent: async (input: { systemPrompt: string }) => {
    agentInputs.push(input);
    return { status: 'completed', text: '回覆', finalText: '', turns: 1, toolCalls: 0 };
  },
}));
vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({
    KB_AUTO_REPLY_ENABLED: true,
    AGENT_WIKI_AUTO_PUBLISH: false,
    AGENT_MAX_TURNS: 1,
    AGENT_MAX_TOOL_CALLS: 1,
    AGENT_TIMEOUT_MS: 1000,
    AGENT_MAX_TOTAL_TOKENS: 1000,
  }),
}));

beforeEach(() => {
  loadCalls.length = 0;
  generateReplyOptions.length = 0;
  agentInputs.length = 0;
});

test('KB 自動回覆：generateReply 收到其他渠道的訊息', async () => {
  const { attemptKbAutoReply } = await import('#src/modules/ai/kb-autoreply.service.js');
  const prisma = {
    automationRule: { findMany: async () => [] },
    conversation: {
      findFirst: async () => ({
        id: 'c1',
        metadata: {},
        channel: { id: 'ch1', channelType: 'FB', credentialsEncrypted: 'x', settings: { botConfig: { botMode: 'llm' } }, isActive: true },
        contact: { channelIdentities: [] },
      }),
    },
    message: { findMany: async () => [] },
  } as never;
  // 回覆送出需要的其他資料不在這個測試範圍；送出失敗不影響已發生的 generateReply 呼叫
  await attemptKbAutoReply(prisma, { to: () => ({ emit: () => {} }) } as never, 'tenant-1', 'c1', '維修進度如何').catch(() => {});
  assert.deepEqual(loadCalls[0], [prisma, 'tenant-1', 'c1']);
  assert.equal(generateReplyOptions.length, 1);
  assert.equal(generateReplyOptions[0].otherChannelContext, OTHER);
});

test('Agent 模式：系統指示包含其他渠道的訊息；沒有對話時不讀取', async () => {
  const { runAgentReply } = await import('#src/modules/ai/agent/agent.service.js');
  const prisma = {
    agentRun: { create: async () => ({ id: 'run1', expiresAt: new Date() }), updateMany: async () => ({ count: 1 }) },
    tenantSettings: { findFirst: async () => ({ identityBinding: {} }) },
    conversation: { findFirst: async () => ({ id: 'c1' }) },
    message: { findMany: async () => [] },
  } as never;
  await runAgentReply(prisma, { tenantId: 'tenant-ctx-1', conversationId: 'c1', userMessage: '維修進度如何' });
  assert.ok(agentInputs[0].systemPrompt.includes(OTHER), agentInputs[0].systemPrompt);

  await runAgentReply(prisma, { tenantId: 'tenant-ctx-1', userMessage: '沒有對話' });
  assert.equal(loadCalls.length, 1, '沒有 conversationId 時不讀取');
  assert.ok(!agentInputs[1].systemPrompt.includes(OTHER));
});
