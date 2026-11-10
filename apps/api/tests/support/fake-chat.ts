/**
 * 假的 Chat provider：取代全域 fetch，只攔截 Ollama 的 `/api/chat` 與 Gemini API，其他請求交給原本的 fetch。
 *
 * provider 是 LLM 呼叫的最低邊界（AGENTS.md「A mock does only what the real code can do」），
 * 所以測試換掉 fetch，保留 llm-client、llm.flow 的真實程式（change migrate-ai-llm-tenant-ctx）。
 * 要同時換掉向量化服務時，先呼叫 fakeOllama()，再呼叫 fakeChat()：`/api/tags`、`/api/embed` 交給 fakeOllama。
 */
import { vi } from 'vitest';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/';

export function fakeChat() {
  const state = {
    /** `/api/chat` 回覆的文字與 token 數 */
    reply: 'AI 的回覆',
    promptTokens: 10,
    outputTokens: 5,
    /** 不是 200 時 `/api/chat` 回這個狀態碼（LLM 失敗） */
    chatStatus: 200,
    /** 回覆之前執行，例如讓回覆變慢 */
    beforeReply: null as null | (() => Promise<void>),
    chatCalls: [] as Array<{ model: string }>,
    /** Gemini 收到的 x-goog-api-key */
    geminiKeys: [] as string[],
  };
  const previous = globalThis.fetch;

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/api/chat')) {
      const body = JSON.parse(String(init?.body)) as { model: string };
      state.chatCalls.push({ model: body.model });
      if (state.beforeReply) await state.beforeReply();
      if (state.chatStatus !== 200) return new Response('model crashed', { status: state.chatStatus });
      return Response.json({
        message: { content: state.reply },
        prompt_eval_count: state.promptTokens,
        eval_count: state.outputTokens,
      });
    }
    if (url.startsWith(GEMINI_BASE)) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      state.geminiKeys.push(headers['x-goog-api-key'] ?? '');
      return Response.json({ name: 'models/gemini-2.5-flash' });
    }
    return previous(input, init);
  });

  function reset() {
    state.reply = 'AI 的回覆';
    state.promptTokens = 10;
    state.outputTokens = 5;
    state.chatStatus = 200;
    state.beforeReply = null;
    state.chatCalls = [];
    state.geminiKeys = [];
  }

  return { state, reset };
}
