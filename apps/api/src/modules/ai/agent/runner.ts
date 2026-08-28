import type { ChatProvider, AgentMessage, ToolCall, ToolDefinition, ToolTurnResult } from '../providers/types.js';

export const AGENT_MAX_TURNS = 100;
export const AGENT_DEFAULT_TIMEOUT_MS = 120_000;
export const AGENT_DEFAULT_MAX_TOOL_CALLS = 30;
export const AGENT_DEFAULT_MAX_REPEATED_CALLS = 3;
export const AGENT_DEFAULT_MAX_TOTAL_TOKENS = 100_000;

export interface AgentRunStore {
  recordToolCall(input: {
    turn: number;
    call: ToolCall;
    status: 'success' | 'failed';
    result: string;
    durationMs: number;
  }): Promise<void>;
  finishRun(input: {
    status: 'completed' | 'failed';
    stopReason?: string;
    turns: number;
    toolCalls: number;
    finalText?: string;
  }): Promise<void>;
  recordUsage?(usage: { promptTokens: number; cachedTokens: number; candidatesTokens: number; thoughtsTokens: number }): Promise<void>;
}

export interface RunAgentInput {
  provider: ChatProvider;
  systemPrompt: string;
  userMessage: string;
  history?: AgentMessage[];
  tools: ToolDefinition[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  store: AgentRunStore;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  timeoutMs?: number;
  maxToolCalls?: number;
  maxRepeatedCalls?: number;
  maxTotalTokens?: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface AgentRunResult {
  text: string;
  status: 'completed' | 'failed';
  turns: number;
  toolCalls: number;
  stopReason?: string;
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const maxTurns = Math.min(Math.max(1, input.maxTurns ?? AGENT_MAX_TURNS), AGENT_MAX_TURNS);
  const maxToolCalls = Math.max(1, input.maxToolCalls ?? AGENT_DEFAULT_MAX_TOOL_CALLS);
  const maxRepeatedCalls = Math.max(1, input.maxRepeatedCalls ?? AGENT_DEFAULT_MAX_REPEATED_CALLS);
  const maxTotalTokens = Math.max(1, input.maxTotalTokens ?? AGENT_DEFAULT_MAX_TOTAL_TOKENS);
  const messages: AgentMessage[] = [...(input.history ?? []), { role: 'user', content: input.userMessage }];
  const repeatedCalls = new Map<string, number>();
  let totalTokens = 0;
  let toolCalls = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    let response: ToolTurnResult;
    try {
      response = await withTimeout(input.provider.generateToolTurn({
        systemPrompt: input.systemPrompt,
        messages,
        tools: input.tools,
        model: input.model ?? 'default',
        temperature: input.temperature ?? 0.2,
        maxTokens: input.maxTokens ?? 1_000,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      }), input.timeoutMs ?? AGENT_DEFAULT_TIMEOUT_MS);
    } catch {
      return await finish(input.store, { status: 'failed', stopReason: 'provider_error', turns: turn, toolCalls });
    }

    totalTokens += response.usage
      ? response.usage.promptTokens + response.usage.candidatesTokens + response.usage.thoughtsTokens
      : 0;
    if (response.usage && input.store.recordUsage) await input.store.recordUsage(response.usage);
    if (totalTokens > maxTotalTokens) {
      return await finish(input.store, { status: 'failed', stopReason: 'max_tokens', turns: turn, toolCalls });
    }

    if (response.toolCalls.length === 0) {
      if (response.text.trim()) return await finish(input.store, { status: 'completed', turns: turn, toolCalls, finalText: response.text.trim() });
      return await finish(input.store, { status: 'failed', stopReason: 'empty_response', turns: turn, toolCalls });
    }

    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
    for (const call of response.toolCalls) {
      if (toolCalls >= maxToolCalls) return await finish(input.store, { status: 'failed', stopReason: 'max_tool_calls', turns: turn, toolCalls });
      const key = `${call.name}:${stableJson(call.arguments)}`;
      const repetition = (repeatedCalls.get(key) ?? 0) + 1;
      repeatedCalls.set(key, repetition);
      const startedAt = Date.now();
      let status: 'success' | 'failed' = 'success';
      let result: string;
      try {
        result = serializeToolResult(await input.executeTool(call.name, call.arguments));
      } catch (error) {
        status = 'failed';
        result = JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 500) : 'Tool execution failed' });
      }
      toolCalls += 1;
      await input.store.recordToolCall({ turn, call: { ...call, arguments: sanitizeArgs(call.arguments) }, status, result: result.slice(0, 30_000), durationMs: Date.now() - startedAt });
      messages.push({ role: 'tool', toolName: call.name, content: result.slice(0, 30_000) });
      if (repetition >= maxRepeatedCalls) return await finish(input.store, { status: 'failed', stopReason: 'repeated_tool_call', turns: turn, toolCalls });
    }
  }

  return await finish(input.store, { status: 'failed', stopReason: 'max_turns', turns: maxTurns, toolCalls });
}

async function finish(store: AgentRunStore, result: Omit<AgentRunResult, 'text'> & { finalText?: string }): Promise<AgentRunResult> {
  const text = result.finalText ?? '目前無法完成這次查詢，已為您保留給客服人員處理。';
  await store.finishRun({ ...result, finalText: result.finalText });
  return { ...result, text };
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => { out[key] = value[key]; return out; }, {}));
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  for (const key of Object.keys(copy)) if (/token|secret|password|authorization|api.?key/i.test(key)) copy[key] = '[REDACTED]';
  return copy;
}

function serializeToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? 'null';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Agent turn timed out')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
