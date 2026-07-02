/**
 * 輕量 LLM 呼叫（離線批次用）。
 *
 * 刻意不 import apps/api 的 provider（會拉整條 config 鏈）；此處直接打 REST，
 * 呼叫邏輯對齊 apps/api/src/modules/ai/providers/gemini.provider.ts：
 *   - 非 pro 模型關 thinking（thinkingConfig.thinkingBudget=0），避免 token 被推理吃光
 *   - MAX_TOKENS 視為截斷，丟錯
 */
import { ENV } from './config.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 120_000;

export interface GeminiOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** 呼叫 Gemini generateContent，回傳純文字。失敗丟錯。 */
export async function geminiGenerate(opts: GeminiOptions): Promise<string> {
  const apiKey = ENV.geminiApiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定（請確認 root .env）');

  const model = opts.model ?? ENV.geminiModel;
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 2048;
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const isProModel = /gemini.*-pro/i.test(model);
    const generationConfig: Record<string, unknown> = {
      temperature,
      maxOutputTokens: isProModel ? Math.max(maxTokens, 2048) : maxTokens,
    };
    if (!isProModel) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: opts.userMessage }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini failed (${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
    };
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error(`Gemini 回覆被 MAX_TOKENS 截斷（maxTokens=${maxTokens}），請調高。`);
    }
    const text = candidate?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini 回傳空內容');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** 呼叫本機 Ollama chat（粗篩用小模型）。 */
export async function ollamaGenerate(
  systemPrompt: string,
  userMessage: string,
  model = ENV.ollamaChatModel,
): Promise<string> {
  const response = await fetch(`${ENV.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return (data.message?.content ?? '').trim();
}

/**
 * 呼叫本機 Ollama embed（BGE-M3，1024 維）。
 * 必須帶 timeout——否則單次請求 hang 住會無限等待、卡死整條聚類流程。
 */
export async function ollamaEmbed(text: string, timeoutMs = 30_000): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ENV.ollamaBaseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ENV.ollamaEmbedModel, input: text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama embed failed (${response.status}): ${await response.text()}`);
    }
    const data = (await response.json()) as { embeddings?: number[][] };
    if (!data.embeddings?.[0]) throw new Error('Ollama 回傳空 embedding');
    return data.embeddings[0];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 容錯解析 LLM 回傳的 JSON 陣列（沿用 classify.service 的抓法：找第一個 [...]）。
 * 解析失敗回 null。
 */
export function parseJsonArray<T>(raw: string): T[] | null {
  // 去掉 ```json ... ``` 圍欄
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '');
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

/** 帶指數退避的重試包裝（給 Gemini 併發呼叫用）。 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
