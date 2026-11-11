import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'vitest';
import { runAgent, type AgentRunStore } from '#src/modules/ai/agent/runner.js';
import { GeminiChatProvider } from '#src/modules/ai/providers/gemini.provider.js';
import type { ToolDefinition, ToolTurnOptions } from '#src/modules/ai/providers/types.js';

// 重現 2026-10-20 創造智能 webchat：gemini-2.5-flash 的 thinking 吃掉 479 token，
// 可見回覆只剩 17 token、停在「…公司，包含」，agent 卻當成完成送給顧客。
const tool: ToolDefinition = { name: 'search_kb', description: 'search', parameters: { type: 'object' } };
const originalFetch = globalThis.fetch;

function options(model: string): ToolTurnOptions {
  return {
    systemPrompt: 'system',
    messages: [{ role: 'user', content: '創造智能是一個什麼樣的公司？' }],
    tools: [tool],
    model,
    temperature: 0.2,
    maxTokens: 500,
    apiKey: 'test-key',
  };
}

function mockGemini(response: unknown): { body?: Record<string, unknown> } {
  const captured: { body?: Record<string, unknown> } = {};
  globalThis.fetch = async (_input, init) => {
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(response), { status: 200 });
  };
  return captured;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GeminiChatProvider.generateToolTurn token 上限', () => {
  test('回覆被 MAX_TOKENS 截斷時丟錯，不回傳半句話', async () => {
    mockGemini({
      candidates: [{
        content: { parts: [{ text: '創造智能（Create Intelligens）是一家提供多種智能服務的公司，包含' }] },
        finishReason: 'MAX_TOKENS',
      }],
      usageMetadata: { candidatesTokenCount: 17, thoughtsTokenCount: 479 },
    });

    await assert.rejects(
      GeminiChatProvider.generateToolTurn(options('gemini-2.5-flash')),
      /MAX_TOKENS/,
    );
  });

  test('非 pro 模型關閉 thinking，token 不被推理吃掉', async () => {
    const captured = mockGemini({ candidates: [{ content: { parts: [{ text: '完成' }] }, finishReason: 'STOP' }] });

    await GeminiChatProvider.generateToolTurn(options('gemini-2.5-flash'));

    const config = captured.body?.generationConfig as Record<string, unknown>;
    assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(config.maxOutputTokens, 500);
  });

  test('pro 模型保留 thinking，maxOutputTokens 至少 2048', async () => {
    const captured = mockGemini({ candidates: [{ content: { parts: [{ text: '完成' }] }, finishReason: 'STOP' }] });

    await GeminiChatProvider.generateToolTurn(options('gemini-2.5-pro'));

    const config = captured.body?.generationConfig as Record<string, unknown>;
    assert.equal(config.thinkingConfig, undefined);
    assert.equal(config.maxOutputTokens, 2048);
  });

  test('agent 遇到截斷回覆時標為失敗，不把半句話當成完成', async () => {
    mockGemini({
      candidates: [{
        content: { parts: [{ text: '創造智能（Create Intelligens）是一家提供多種智能服務的公司，包含' }] },
        finishReason: 'MAX_TOKENS',
      }],
      usageMetadata: { candidatesTokenCount: 17, thoughtsTokenCount: 479 },
    });
    const finished: { status?: string; stopReason?: string } = {};
    const store: AgentRunStore = {
      async recordToolCall() {},
      async finishRun(input) { Object.assign(finished, input); },
    };

    const result = await runAgent({
      provider: GeminiChatProvider,
      systemPrompt: 'system', userMessage: '創造智能是一個什麼樣的公司？', tools: [tool], store,
      model: 'gemini-2.5-flash', maxTokens: 500, apiKey: 'test-key',
      executeTool: async () => 'unused',
    });

    // status 不是 completed，automation worker 才會退回 KB 回覆
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'provider_error');
    assert.equal(finished.status, 'failed');
  });
});
