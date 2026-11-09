/**
 * 假的向量化服務（Ollama）：取代全域 fetch，只攔截 `baseUrl` 開頭的請求，其他請求照常送出。
 *
 * 向量化服務是外部呼叫的最低邊界（AGENTS.md「A mock does only what the real code can do」），
 * 所以測試換掉 fetch，保留 embedding 模組的真實程式。
 */
import { vi } from 'vitest';

export const OLLAMA_BASE_URL = 'http://localhost:11434';
/**
 * 假向量的維度：跟 migration 建立的 `km_articles.embedding` 欄位一樣（vector(1536)）。
 * schema.prisma 寫 1024，兩者不一致是已知問題（docs/ref/system/AUDIT.md DB-01）。DB-01 修正時改這裡。
 */
export const VECTOR_DIM = 1536;

/** 第一個元素是 `marker`、其餘是 0 的向量；以 `vectorMarker()` 從資料庫讀回的文字分辨是哪一個 */
export function markedVector(marker: number): number[] {
  return [marker, ...new Array<number>(VECTOR_DIM - 1).fill(0)];
}

/** pgvector 的文字格式（`[1,0,0,...]`）取出第一個元素；NULL 時回 null */
export function vectorMarker(text: string | null): number | null {
  if (text === null) return null;
  return Number(text.slice(1, text.indexOf(',')));
}

export function fakeOllama(baseUrl = OLLAMA_BASE_URL) {
  const state = {
    /** `/api/tags` 回的模型清單；`tagsError` 有值時改成連線失敗 */
    models: [{ name: 'bge-m3:latest' }] as Array<{ name: string }>,
    tagsError: null as Error | null,
    /** `/api/embed` 回的向量與狀態碼 */
    vector: markedVector(1),
    embedStatus: 200,
    /** 收到的 `/api/embed` 請求 */
    embedCalls: [] as Array<{ model: string; input: string }>,
    /** 回傳向量之前執行，例如在向量化期間修改文章 */
    beforeEmbedReturns: null as null | ((call: { model: string; input: string }) => Promise<void>),
  };
  const original = globalThis.fetch;

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(baseUrl)) return original(input, init);
    if (url === `${baseUrl}/api/tags`) {
      if (state.tagsError) throw state.tagsError;
      return Response.json({ models: state.models });
    }
    if (url === `${baseUrl}/api/embed`) {
      const call = JSON.parse(String(init?.body)) as { model: string; input: string };
      state.embedCalls.push(call);
      if (state.beforeEmbedReturns) await state.beforeEmbedReturns(call);
      if (state.embedStatus !== 200) return new Response('embedding service down', { status: state.embedStatus });
      return Response.json({ embeddings: [state.vector] });
    }
    throw new Error(`假的向量化服務沒有這個路徑：${url}`);
  });

  function reset() {
    state.models = [{ name: 'bge-m3:latest' }];
    state.tagsError = null;
    state.vector = markedVector(1);
    state.embedStatus = 200;
    state.embedCalls = [];
    state.beforeEmbedReturns = null;
  }

  return { state, reset, restore: () => vi.unstubAllGlobals() };
}
