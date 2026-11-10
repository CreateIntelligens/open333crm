/**
 * Agent 執行不在交易內等待外部呼叫（change migrate-ai-agent-tenant-ctx：
 * agentic-llm-orchestration「Agent 執行不在交易內等待外部呼叫」）。
 *
 * 交易換成會記錄「目前有幾個交易還沒結束」的 mock；LLM 與工具被呼叫時，記下當時還沒結束的交易數。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  open: 0,
  /** 呼叫外部服務當下還沒結束的交易數 */
  calls: [] as Array<{ kind: 'llm' | 'tool'; openTransactions: number }>,
  turn: 0,
}));

vi.mock('#src/modules/ai/llm.flow.js', () => ({
  prepareLlmCall: async () => ({
    tenantId: 'a1a1a1a1-0000-4000-8000-000000000010',
    settings: { provider: 'gemini', model: 'm', temperature: 0, maxTokens: 10, baseUrl: '', chatSystemPrompt: '' },
    privacy: { enabled: false },
    apiKey: 'k',
    keySource: 'platform',
    monthlyTokens: null,
  }),
  recordLlmUsage: async () => {},
}));
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'gemini',
    generate: async () => ({ text: '' }),
    generateToolTurn: async () => {
      state.calls.push({ kind: 'llm', openTransactions: state.open });
      state.turn += 1;
      return state.turn === 1
        ? { text: '', toolCalls: [{ id: 't1', name: 'get_live_weather', arguments: { location: '台北' } }] }
        : { text: '台北今天晴天', toolCalls: [] };
    },
  }),
}));
vi.mock('#src/modules/ai/agent/weather.js', () => ({
  getLiveWeather: async () => {
    state.calls.push({ kind: 'tool', openTransactions: state.open });
    return { summary: '晴天' };
  },
}));
vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({
    AGENT_WIKI_AUTO_PUBLISH: false,
    AGENT_MAX_TURNS: 5,
    AGENT_MAX_TOOL_CALLS: 5,
    AGENT_TIMEOUT_MS: 10_000,
    AGENT_MAX_TOTAL_TOKENS: 10_000,
  }),
}));

const { runAgentReplyFlow } = await import('#src/modules/ai/agent/agent.flow.js');

/** 記錄交易數的 Prisma mock：$transaction 進入時 +1，結束時 -1 */
function countingPrisma(tx: Record<string, unknown>) {
  const txWithTenant = { $executeRaw: async () => 1, ...tx };
  return {
    async $transaction(cb: (t: unknown) => Promise<unknown>) {
      state.open += 1;
      try {
        return await cb(txWithTenant);
      } finally {
        state.open -= 1;
      }
    },
  } as never;
}

beforeEach(() => {
  state.open = 0;
  state.calls.length = 0;
  state.turn = 0;
});

test('呼叫外部服務之前交易已經結束：每次呼叫 LLM 與工具時，沒有還沒結束的交易', async () => {
  const toolCalls: unknown[] = [];
  const prisma = countingPrisma({
    conversation: { findFirst: async () => ({ id: 'c1', contactId: 'ct1' }) },
    message: { findMany: async () => [] },
    agentRun: { create: async () => ({ id: 'run1', expiresAt: new Date() }), updateMany: async () => ({ count: 1 }) },
    agentToolCall: { create: async (args: unknown) => { toolCalls.push(args); return {}; } },
  });

  const result = await runAgentReplyFlow(
    { prisma, llm: { prisma, redis: {} as never, events: {} as never } },
    { tenantId: 'a1a1a1a1-0000-4000-8000-000000000010', conversationId: 'c1', userMessage: '台北天氣' },
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(state.calls, [
    { kind: 'llm', openTransactions: 0 },
    { kind: 'tool', openTransactions: 0 },
    { kind: 'llm', openTransactions: 0 },
  ]);
  assert.equal(toolCalls.length, 1, '工具紀錄在第二次呼叫 LLM 之前寫入');
});
