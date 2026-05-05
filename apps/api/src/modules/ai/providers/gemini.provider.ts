import { getConfig } from '../../../config/env.js';
import type {
  ChatProvider,
  ChatGenerateOptions,
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

function getApiKey(): string {
  const key = getConfig().GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured in environment');
  return key;
}

export const GeminiChatProvider: ChatProvider = {
  id: 'gemini',
  label: 'Google Gemini',

  async generate(opts: ChatGenerateOptions): Promise<string> {
    const apiKey = getApiKey();
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`;

    const fullSystemPrompt = opts.kbContext
      ? `${opts.systemPrompt}\n\n以下是相關知識庫內容，請根據這些內容回答客戶問題：\n${opts.kbContext}`
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

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: fullSystemPrompt }] },
          contents,
          generationConfig: {
            temperature: opts.temperature,
            maxOutputTokens: opts.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Gemini generateContent failed (${response.status}): ${errBody}`);
      }

      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };

      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim();

      if (!text) throw new Error('Gemini returned empty response');
      return text;
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
