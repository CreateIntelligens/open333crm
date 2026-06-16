import type {
  ChatProvider,
  ChatGenerateOptions,
  ChatModelInfo,
  ChatProviderHealth,
} from './types.js';

const TIMEOUT_MS = 120_000;

export const OllamaChatProvider: ChatProvider = {
  id: 'ollama',
  label: 'Ollama (local)',

  async generate(opts: ChatGenerateOptions): Promise<string> {
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

      const data = (await response.json()) as { message?: { content: string } };
      const text = data.message?.content?.trim();
      if (!text) throw new Error('Ollama returned empty chat response');
      return text;
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
