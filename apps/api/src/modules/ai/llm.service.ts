/**
 * LLM Service — generates RAG replies via the per-tenant chat provider.
 *
 * Provider (Ollama / Gemini), model, temperature, max tokens, and system
 * prompts are all loaded from TenantSettings at call time. Defaults below
 * are used as fallback when a tenant's prompt fields are empty strings.
 */

import type { PrismaClient } from '@prisma/client';
import { getChatProvider } from './providers/index.js';
import type { HistoryMessage } from './providers/index.js';
import { getChatSettings } from '../settings/chat-settings.service.js';

export type { HistoryMessage } from './providers/index.js';

/**
 * Default CRM customer-service system prompt. Used when a tenant has not
 * customized its chatSystemPrompt yet (empty string).
 */
export const CRM_REPLY_SYSTEM_PROMPT =
  '你是「Open333」品牌的專業客服助手，負責回答客戶關於家電產品（冰箱、洗衣機、冷氣、電視等）的問題。\n' +
  '請遵守以下規則：\n' +
  '1. 全程使用繁體中文回覆，語氣親切專業\n' +
  '2. 回覆控制在 3-5 句話內，簡潔扼要\n' +
  '3. 如果知識庫有相關內容，優先引用知識庫的資訊\n' +
  '4. 如果無法確定答案，請說「我幫您確認一下，稍後由專人為您服務」\n' +
  '5. 不要編造保固期限、價格、技術規格等具體數字\n' +
  '6. 遇到客訴或緊急問題，建議客戶「我立刻為您轉接專人處理」\n' +
  '7. 結尾可適當加上「還有其他需要幫忙的嗎？」';

/**
 * Default conversation summarization system prompt.
 */
export const SUMMARIZE_SYSTEM_PROMPT =
  '你是一位客服系統的對話分析助手。請根據以下對話記錄，用繁體中文產生簡潔的對話摘要。' +
  '摘要應包含：客戶的主要問題或需求、目前的處理狀態、以及後續建議的行動。' +
  '請用 2-4 句話完成摘要，不要超過 200 字。';

/**
 * Default system prompt used when KB confidence is too low to answer directly.
 * The bot should ask a single clarifying question instead of guessing.
 */
export const CLARIFY_SYSTEM_PROMPT =
  '你是「Open333」品牌的客服助手。客戶剛剛的訊息資訊不足，無法判斷他真正的問題。' +
  '請參考前面的對話脈絡，用繁體中文禮貌地反問**一個**最關鍵的澄清問題以取得更多資訊。\n' +
  '規則：\n' +
  '1. 只問一個問題，不要連珠炮\n' +
  '2. 問題要具體、可回答（避免「請問需要什麼幫助」這類空泛問句）\n' +
  '3. 如果是家電問題，優先問：是哪個產品 / 故障狀況 / 型號\n' +
  '4. 整體控制在 2 句話以內\n' +
  '5. 不要編造或假設客戶的需求';

type PromptKind = 'reply' | 'summarize';

/**
 * Generate a reply for a tenant. Uses tenant chat settings + system prompt.
 *
 * `promptKind` selects which system prompt to use:
 *   - 'reply'     → tenant.chatSystemPrompt    (fallback CRM_REPLY_SYSTEM_PROMPT)
 *   - 'summarize' → tenant.summarizeSystemPrompt (fallback SUMMARIZE_SYSTEM_PROMPT)
 *
 * `overrideSystemPrompt` lets callers (e.g. automation rules with custom
 * prompts) inject their own prompt without touching tenant defaults.
 */
export async function generateReply(
  prisma: PrismaClient,
  tenantId: string,
  userMessage: string,
  kbContext = '',
  options: {
    promptKind?: PromptKind;
    overrideSystemPrompt?: string;
    history?: HistoryMessage[];
  } = {},
): Promise<string> {
  const settings = await getChatSettings(prisma, tenantId);
  const provider = getChatProvider(settings.provider);

  const promptKind = options.promptKind ?? 'reply';
  const systemPrompt =
    options.overrideSystemPrompt ??
    (promptKind === 'summarize'
      ? settings.summarizeSystemPrompt || SUMMARIZE_SYSTEM_PROMPT
      : settings.chatSystemPrompt || CRM_REPLY_SYSTEM_PROMPT);

  return provider.generate({
    systemPrompt,
    userMessage,
    kbContext,
    history: options.history,
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    baseUrl: settings.baseUrl,
  });
}
