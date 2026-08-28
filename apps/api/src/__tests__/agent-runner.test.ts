import assert from 'node:assert/strict';
import { runAgent, type AgentRunStore } from '../modules/ai/agent/runner.js';
import type { AgentMessage, ChatProvider, ToolCall, ToolDefinition, ToolTurnOptions, ToolTurnResult } from '../modules/ai/providers/types.js';

const tool: ToolDefinition = { name: 'search_web', description: 'search', parameters: { type: 'object' } };

function fakeProvider(turns: ToolTurnResult[]): ChatProvider {
  let index = 0;
  return {
    id: 'ollama', label: 'fake',
    async generate() { return { text: '' }; },
    async generateToolTurn(_opts: ToolTurnOptions) { return turns[Math.min(index++, turns.length - 1)]; },
    async listModels() { return []; },
    async health() { return { ok: true, reachable: true, modelInstalled: true, currentModel: 'fake' }; },
  };
}

function store(): AgentRunStore & { toolCalls: number; stopReason?: string } {
  return {
    toolCalls: 0,
    async recordToolCall() { this.toolCalls += 1; },
    async finishRun(input) { this.stopReason = input.stopReason; },
  };
}

const call: ToolCall = { id: 'call-1', name: 'search_web', arguments: { query: 'Open333' } };
const completedStore = store();
const completed = await runAgent({
  provider: fakeProvider([
    { text: '', toolCalls: [call] },
    { text: '完成回答', toolCalls: [] },
  ]),
  systemPrompt: 'system', userMessage: '查資料', tools: [tool], store: completedStore,
  executeTool: async () => ({ results: [{ title: 'Open333', url: 'https://example.com', snippet: 'ok' }] }),
});
assert.equal(completed.text, '完成回答');
assert.equal(completed.turns, 2);
assert.equal(completedStore.toolCalls, 1);

const limitStore = store();
const limited = await runAgent({
  provider: fakeProvider([{ text: '', toolCalls: [call] }]),
  systemPrompt: 'system', userMessage: '一直查', tools: [tool], store: limitStore,
  executeTool: async () => 'same result',
  maxTurns: 100,
  maxToolCalls: 200,
  maxRepeatedCalls: 200,
});
assert.equal(limited.turns, 100);
assert.equal(limited.stopReason, 'max_turns');
assert.equal(limitStore.toolCalls, 100);

const repeatStore = store();
const repeated = await runAgent({
  provider: fakeProvider([{ text: '', toolCalls: [call] }]),
  systemPrompt: 'system', userMessage: '不要死循環', tools: [tool], store: repeatStore,
  executeTool: async () => 'same result', maxTurns: 100, maxToolCalls: 100,
  maxRepeatedCalls: 2,
});
assert.equal(repeated.stopReason, 'repeated_tool_call');
assert.equal(repeated.turns, 2);

console.log('agent-runner tests passed');
