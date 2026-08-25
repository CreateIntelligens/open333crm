import { logger } from '@open333crm/core';
import { getConfig } from '../../../config/env.js';
import type {
  ChatProvider,
  ChatGenerateOptions,
  ChatGenerateResult,
  ChatModelInfo,
  ChatProviderHealth,
} from './types.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 120_000;

// Curated whitelist — only models that make sense for CRM customer-service chat.
// We display these in the dropdown by default; other models (TTS, image,
// robotics, deep-research) are filtered out even if the API exposes them.
const CURATED_CHAT_MODELS: { id: string; label: string; tier: ChatModelInfo['tier'] }[] = [
  // Stable
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（推薦）', tier: 'stable' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite（最便宜）', tier: 'stable' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（最聰明）', tier: 'stable' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'stable' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', tier: 'stable' },
  // Latest aliases
  { id: 'gemini-flash-latest', label: 'Gemini Flash (Latest)', tier: 'latest' },
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (Latest)', tier: 'latest' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro (Latest)', tier: 'latest' },
  // Preview (unstable)
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', tier: 'preview' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', tier: 'preview' },
];

// BYOK：優先用傳入的租戶 key，否則退回全域 env
function getApiKey(override?: string): string {
  const key = override ?? getConfig().GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured in environment');
  return key;
}

export const GeminiChatProvider: ChatProvider = {
  id: 'gemini',
  label: 'Google Gemini',

  async generate(opts: ChatGenerateOptions): Promise<ChatGenerateResult> {
    const apiKey = getApiKey(opts.apiKey);
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`;

    const fullSystemPrompt = opts.kbContext
      ? `${opts.systemPrompt}\n\n以下是「唯一可用」的知識庫內容。你的回答只能基於以下內容，超出這些內容範圍的資訊（尤其是型號、規格、電話、地址等具體事實）一律不可回答，請改為轉接專人：\n${opts.kbContext}`
      : opts.systemPrompt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Gemini uses role='user' | 'model' (NOT 'assistant'); convert history.
      const contents = [
        ...(opts.history ?? []).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: opts.userMessage }] },
      ];

      // Gemini 2.5 Pro 強制啟用 thinking mode，傳 thinkingBudget:0 會直接
      // 回 400「Budget 0 is invalid. This model only works in thinking mode」。
      // 其餘 2.5 系列（flash/flash-lite）預設也開 thinking，會把 token 花在
      // 內部推理導致可見輸出被截斷，故對「非 pro」明確關閉 thinking。
      const isProModel = /gemini.*-pro/i.test(opts.model);

      const generationConfig: Record<string, unknown> = {
        temperature: opts.temperature,
        // Pro 開著 thinking 會先吃掉一部分 token 做推理，maxTokens 太小會讓
        // 可見回覆被截光，故 pro 給一個較高的下限保底。
        maxOutputTokens: isProModel ? Math.max(opts.maxTokens, 2048) : opts.maxTokens,
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
          systemInstruction: { parts: [{ text: fullSystemPrompt }] },
          contents,
          generationConfig,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Gemini generateContent failed (${response.status}): ${errBody}`);
      }

      const data = (await response.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
        usageMetadata?: {
          promptTokenCount?: number;
          cachedContentTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim();

      // MAX_TOKENS = output truncated. Throw with diagnostic info so
      // operators see why the user got a half sentence (raise chatMaxTokens
      // or keep thinking disabled).
      if (candidate?.finishReason === 'MAX_TOKENS') {
        const usage = data.usageMetadata ?? {};
        throw new Error(
          `Gemini reply truncated by MAX_TOKENS (output=${usage.candidatesTokenCount ?? '?'} thoughts=${usage.thoughtsTokenCount ?? 0} max=${opts.maxTokens}). Increase chatMaxTokens or ensure thinkingConfig.thinkingBudget=0.`,
        );
      }
      if (!text) throw new Error('Gemini returned empty response');

      const um = data.usageMetadata;
      let usage: ChatGenerateResult['usage'];
      if (um) {
        usage = {
          promptTokens: um.promptTokenCount ?? 0,
          cachedTokens: um.cachedContentTokenCount ?? 0,
          candidatesTokens: um.candidatesTokenCount ?? 0,
          thoughtsTokens: um.thoughtsTokenCount ?? 0,
        };
        // 與 totalTokenCount 交叉檢查：某些 preview 模型會漏回個別欄位，
        // 偏差過大代表 usage 不可信，log 供對帳時排查（仍照實記錄）。
        const sum = usage.promptTokens + usage.candidatesTokens + usage.thoughtsTokens;
        const total = um.totalTokenCount ?? 0;
        if (total > 0 && Math.abs(total - sum) / total > 0.1) {
          logger.warn(
            `[gemini] usageMetadata mismatch: totalTokenCount=${total} but parts sum=${sum} (model=${opts.model})`,
          );
        }
      }
      return { text, usage };
    } finally {
      clearTimeout(timer);
    }
  },

  async listModels(): Promise<ChatModelInfo[]> {
    // We always return the curated list (UI dropdown); the live API call only
    // serves as a key-validity check and is not used to drive UI options.
    return CURATED_CHAT_MODELS.map((m) => ({ ...m }));
  },

  async health({ model }): Promise<ChatProviderHealth> {
    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch (err) {
      return {
        ok: false,
        reachable: false,
        modelInstalled: false,
        currentModel: model,
        error: (err as Error).message,
      };
    }

    try {
      const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}`, {
        headers: { 'x-goog-api-key': apiKey },
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          reachable: true,
          modelInstalled: false,
          currentModel: model,
          error: `Gemini API ${res.status}: ${body.slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        reachable: true,
        modelInstalled: true,
        currentModel: model,
      };
    } catch (err) {
      return {
        ok: false,
        reachable: false,
        modelInstalled: false,
        currentModel: model,
        error: `Cannot reach Gemini: ${(err as Error).message}`,
      };
    }
  },
};
