import assert from 'node:assert/strict';
import { OllamaChatProvider } from '../modules/ai/providers/ollama.provider.js';
import { GeminiChatProvider } from '../modules/ai/providers/gemini.provider.js';
import type { ToolDefinition } from '../modules/ai/providers/types.js';

const tool: ToolDefinition = { name: 'search_web', description: 'search', parameters: { type: 'object', required: ['query'] } };
const originalFetch = globalThis.fetch;
try {
  let ollamaBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    ollamaBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'search_web', arguments: { query: 'Open333' } } }] } }), { status: 200 });
  };
  const ollamaResult = await OllamaChatProvider.generateToolTurn({
    systemPrompt: 'system', messages: [{ role: 'user', content: '查詢' }], tools: [tool], model: 'qwen3', temperature: 0.2, maxTokens: 500,
  });
  assert.equal(ollamaResult.toolCalls[0]?.name, 'search_web');
  assert.equal((ollamaBody?.tools as Array<{ function: { name: string } }>)[0].function.name, 'search_web');

  let geminiBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    geminiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'search_web', args: { query: 'Open333' } } }] } }] }), { status: 200 });
  };
  const geminiResult = await GeminiChatProvider.generateToolTurn({
    systemPrompt: 'system', messages: [{ role: 'user', content: '查詢' }], tools: [tool], model: 'gemini-2.5-flash', temperature: 0.2, maxTokens: 500, apiKey: 'test-key',
  });
  assert.equal(geminiResult.toolCalls[0]?.name, 'search_web');
  assert.ok(Array.isArray(geminiBody?.tools));
  assert.ok(geminiBody?.contents);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('agent-provider-tools tests passed');
