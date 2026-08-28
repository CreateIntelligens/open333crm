import type {
  AgentMessage,
  ChatProvider,
  ChatGenerateOptions,
  ChatGenerateResult,
  ChatModelInfo,
  ChatProviderHealth,
  ToolCall,
  ToolTurnOptions,
  ToolTurnResult,
} from './types.js';

const TIMEOUT_MS = 120_000;

export const OllamaChatProvider: ChatProvider = {
  id: 'ollama',
  label: 'Ollama (local)',

  async generate(opts: ChatGenerateOptions): Promise<ChatGenerateResult> {
    const baseUrl = opts.baseUrl ?? 'http://localhost:11434';
    const url = `${baseUrl}/api/chat`;

    const fullSystemPrompt = opts.kbContext
      ? `${opts.systemPrompt}\n\n以下是「唯一可用」的知識庫內容。你的回答只能基於以下內容，超出這些內容範圍的資訊（尤其是型號、規格、電話、地址等具體事實）一律不可回答，請改為轉接專人：\n${opts.kbContext}`
      : opts.systemPrompt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: fullSystemPrompt },
        ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: opts.userMessage },
      ];

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          messages,
          stream: false,
          options: {
            temperature: opts.temperature,
            num_predict: opts.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama chat failed (${response.status}): ${errBody}`);
      }

      const data = (await response.json()) as {
        message?: { content: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const text = data.message?.content?.trim();
      if (!text) throw new Error('Ollama returned empty chat response');

      // Ollama 非串流回應帶 prompt_eval_count / eval_count；舊版可能缺欄位。
      const usage =
        data.prompt_eval_count !== undefined || data.eval_count !== undefined
          ? {
              promptTokens: data.prompt_eval_count ?? 0,
              cachedTokens: 0,
              candidatesTokens: data.eval_count ?? 0,
              thoughtsTokens: 0,
            }
          : undefined;
      return { text, usage };
    } finally {
      clearTimeout(timer);
    }
  },

  async generateToolTurn(opts: ToolTurnOptions): Promise<ToolTurnResult> {
    const baseUrl = opts.baseUrl ?? 'http://localhost:11434';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: opts.systemPrompt },
      ...opts.messages.map(toOllamaMessage),
    ];
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          messages,
          stream: false,
          tools: opts.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          options: { temperature: opts.temperature, num_predict: opts.maxTokens },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Ollama tool call failed (${response.status}): ${await response.text()}`);
      const data = (await response.json()) as {
        message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const toolCalls = (data.message?.tool_calls ?? []).flatMap((call, index): ToolCall[] => {
        const fn = call.function;
        if (!fn?.name) return [];
        const args = parseToolArguments(fn.arguments);
        return [{ id: `ollama-${Date.now()}-${index}`, name: fn.name, arguments: args }];
      });
      const usage = data.prompt_eval_count !== undefined || data.eval_count !== undefined
        ? { promptTokens: data.prompt_eval_count ?? 0, cachedTokens: 0, candidatesTokens: data.eval_count ?? 0, thoughtsTokens: 0 }
        : undefined;
      return { text: data.message?.content?.trim() ?? '', toolCalls, usage };
    } finally {
      clearTimeout(timer);
    }
  },

  async listModels({ baseUrl }): Promise<ChatModelInfo[]> {
    const url = `${baseUrl ?? 'http://localhost:11434'}/api/tags`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: { name: string; size?: number }[] };
      return (data.models ?? []).map((m) => ({
        id: m.name.replace(/:latest$/, ''),
        label: m.name,
        tier: 'stable' as const,
      }));
    } catch {
      return [];
    }
  },

  async health({ baseUrl, model }): Promise<ChatProviderHealth> {
    const url = `${baseUrl ?? 'http://localhost:11434'}/api/tags`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return {
          ok: false,
          reachable: false,
          modelInstalled: false,
          currentModel: model,
          error: `Ollama responded ${res.status}`,
        };
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      const models = data.models ?? [];
      const installed = models.some(
        (m) => m.name === model || m.name.startsWith(`${model}:`),
      );
      return {
        ok: installed,
        reachable: true,
        modelInstalled: installed,
        currentModel: model,
        error: installed
          ? undefined
          : `Model "${model}" not installed locally. Available: ${models.map((m) => m.name).join(', ') || 'none'}`,
      };
    } catch (err) {
      return {
        ok: false,
        reachable: false,
        modelInstalled: false,
        currentModel: model,
        error: `Cannot reach Ollama: ${(err as Error).message}`,
      };
    }
  },
};

function toOllamaMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls?.length
        ? { tool_calls: message.toolCalls.map((call) => ({ type: 'function', function: { name: call.name, arguments: call.arguments } })) }
        : {}),
    };
  }
  if (message.role === 'tool') {
    return { role: 'tool', tool_name: message.toolName, content: message.content };
  }
  return { role: 'user', content: message.content };
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Invalid provider arguments are handled by the Agent registry validator.
    }
  }
  return {};
}
