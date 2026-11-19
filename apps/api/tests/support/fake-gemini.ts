/**
 * 假的 Gemini 向量化服務：取代全域 fetch，只攔截 Gemini 的網址，其他請求照常送出。
 *
 * Gemini 是外部呼叫的最低邊界，所以測試換掉 fetch，保留向量化模組的真實程式。
 */
import { vi } from 'vitest';
import { markedVector } from './fake-ollama.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function fakeGemini() {
  const state = {
    vector: markedVector(1),
    /** embedContent 回的狀態碼 */
    embedStatus: 200,
    /** models/gemini-embedding-001 回的狀態碼 */
    modelStatus: 200,
    embedCalls: [] as Array<{ apiKey: string | null; taskType: string; text: string; outputDimensionality: number }>,
    modelCalls: 0,
  };
  const original = globalThis.fetch;

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(GEMINI_BASE)) return original(input, init);
    const apiKey = new Headers(init?.headers).get('x-goog-api-key');
    if (url.endsWith(':embedContent')) {
      const body = JSON.parse(String(init?.body));
      state.embedCalls.push({
        apiKey,
        taskType: body.taskType,
        text: body.content.parts[0].text,
        outputDimensionality: body.outputDimensionality,
      });
      if (state.embedStatus !== 200) return new Response('{"error":"bad"}', { status: state.embedStatus });
      return Response.json({ embedding: { values: state.vector } });
    }
    if (url.endsWith('/models/gemini-embedding-001')) {
      state.modelCalls++;
      return new Response(state.modelStatus === 200 ? '{"name":"models/gemini-embedding-001"}' : 'denied', {
        status: state.modelStatus,
      });
    }
    throw new Error(`假的 Gemini 沒有這個路徑：${url}`);
  });

  function reset() {
    state.vector = markedVector(1);
    state.embedStatus = 200;
    state.modelStatus = 200;
    state.embedCalls = [];
    state.modelCalls = 0;
  }

  function restore() {
    vi.stubGlobal('fetch', original);
  }

  return { state, reset, restore };
}
