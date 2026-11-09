/**
 * 向量化服務（Ollama）的 HTTP 呼叫（change migrate-embedding-tenant-ctx，design D1）。
 *
 * 這個檔案不碰資料庫：呼叫端先在交易內讀設定與遮罩政策，再在交易外呼叫這裡的函式。
 * 不要在交易內呼叫：最久要 51 秒（見 EMBED_TIMEOUT_MS），交易逾時是 5 秒（AGENTS.md 結構規則 2）。
 */
import { logger } from '@open333crm/core';
import { deidentifyTenantText } from '../ai/deidentification.service.js';
import type { AiPrivacyPolicy } from '../platform/ai-privacy.service.js';

/** 向量化的目標：租戶設定的服務網址與模型 */
export interface EmbeddingTarget {
  baseUrl: string;
  model: string;
}

// ─── 向量化 ─────────────────────────────────────────────────────────────────

/**
 * 單次 embed 請求的逾時（毫秒）。
 *
 * 為什麼需要：原本的 fetch 沒有任何 timeout。Ollama 閒置一段時間會把
 * bge-m3 卸載，下一個請求要等模型重載（實測約 30~40 秒），期間每個請求
 * 都卡滿 Caddy 的 60s gateway timeout → 使用者連吃 3~5 次 504，每次等 60 秒。
 *
 * 設 25 秒：比 gateway 的 60s 短很多，讓我們能在「被 Caddy 切斷」之前
 * 自己收手並重試，把控制權留在應用層。
 */
const EMBED_TIMEOUT_MS = 25_000;

/**
 * 冷啟動重試次數。第一次逾時多半是模型正在載入，
 * 重試時模型通常已經在記憶體裡，會很快回來。
 *
 * 只重試 1 次是被 gateway 預算決定的，不是隨便選的：
 *   最壞總耗時 = 25s × 2 次 + 1s 重試間隔 = 51s
 * Caddy 的 gateway timeout 是 60s，扣掉 DB 查詢與序列化的餘裕（約 5s），
 * 可用預算約 55s。重試 2 次會變成 77s，反而又回到「被 Caddy 切斷」的老問題。
 */
const EMBED_COLD_START_RETRIES = 1;

/**
 * 帶 HTTP status 的 embed 錯誤。
 *
 * 為什麼不靠解析 err.message：重試判斷原本用 /\(50[23]\)/ 比對訊息文字，
 * 只要上游換個格式（"503 Service Unavailable"、"status code 503"）就失效，
 * 冷啟動的 503 會直接把錯誤丟給使用者。改成型別帶 status，判斷不依賴文字。
 */
class EmbedHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Ollama embed failed (${status}): ${body}`);
    this.name = 'EmbedHttpError';
  }
}

/** 單次呼叫 Ollama embed，帶逾時 */
async function embedOnce(url: string, model: string, text: string, timeoutMs: number): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new EmbedHttpError(response.status, errBody);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    if (!data.embeddings || !data.embeddings[0]) {
      throw new Error('Ollama returned empty embeddings');
    }
    return data.embeddings[0];
  } finally {
    clearTimeout(timer);
  }
}

/** 依租戶的遮罩政策遮罩文字，再呼叫向量化服務。冷啟動時重試一次 */
export async function embedText(target: EmbeddingTarget, policy: AiPrivacyPolicy, text: string): Promise<number[]> {
  const url = `${target.baseUrl}/api/embed`;
  const protectedText = await deidentifyTenantText(policy, text);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= EMBED_COLD_START_RETRIES; attempt++) {
    try {
      return await embedOnce(url, target.model, protectedText, EMBED_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      // 冷啟動有兩種表現，都要重試：
      //   1. AbortError——請求打出去了但模型還在載入，卡到我們的 timeout
      //   2. HTTP 503——Ollama 明確回「服務尚未就緒」，這種會「立刻」失敗，
      //      只認 AbortError 的話第一次就直接把錯誤丟給使用者，等於沒處理冷啟動
      const aborted = err instanceof Error && err.name === 'AbortError';
      // 502/503 = 上游尚未就緒（Ollama 載入模型中），與逾時同樣值得重試
      const unavailable = err instanceof EmbedHttpError && (err.status === 502 || err.status === 503);
      const retryable = aborted || unavailable;
      if (!retryable || attempt === EMBED_COLD_START_RETRIES) break;
      logger.warn(
        `[Embedding] embed ${aborted ? '逾時' : '服務未就緒'}` +
          `（第 ${attempt + 1} 次），模型可能正在載入，重試中`,
      );
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  if (lastErr instanceof Error && lastErr.name === 'AbortError') {
    // 轉成可讀訊息：使用者看到的不該是 "AbortError"
    throw new Error(
      `向量化服務逾時（${EMBED_TIMEOUT_MS / 1000} 秒 × ${EMBED_COLD_START_RETRIES + 1} 次）。` +
        'AI 模型可能正在載入，請稍候再試；若持續發生請至「知識庫 → Embedding 設定」檢查服務狀態。',
    );
  }
  throw lastErr;
}

// ─── 健康檢查 ───────────────────────────────────────────────────────────────

export interface EmbeddingServiceModel {
  name: string;
  size?: number;
  modified_at?: string;
}

/** `probeEmbeddingService()` 的結果。兩個健康檢查端點各自轉成原本的回應格式 */
export type EmbeddingServiceProbe =
  | { reachable: false; error: string }
  | { reachable: true; models: EmbeddingServiceModel[]; installed: EmbeddingServiceModel | undefined };

/**
 * 呼叫 `/api/tags`：服務連得到，而且模型清單中有名稱等於 `model`、或以 `model:` 開頭的模型，才算正常
 * （spec embedding-settings「向量化服務的健康檢查」）。
 */
export async function probeEmbeddingService(baseUrl: string, model: string): Promise<EmbeddingServiceProbe> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return { reachable: false, error: `Ollama responded ${response.status}` };
    const data = (await response.json()) as { models?: EmbeddingServiceModel[] };
    const models = data.models ?? [];
    const installed = models.find((m) => m.name === model || m.name.startsWith(`${model}:`));
    return { reachable: true, models, installed };
  } catch (err) {
    return { reachable: false, error: `Cannot reach Ollama at ${baseUrl}: ${(err as Error).message}` };
  }
}

/** 服務上沒有這個模型時的錯誤訊息，列出服務上有的模型 */
export function modelNotInstalledError(model: string, models: EmbeddingServiceModel[]): string {
  return `Model "${model}" not installed. Available: ${models.map((m) => m.name).join(', ') || 'none'}`;
}
