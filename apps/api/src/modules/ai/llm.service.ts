/**
 * LLM Service — calls Ollama chat API for RAG-based reply generation.
 */

import { getConfig } from '../../config/env.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: { content: string };
}

const LLM_TIMEOUT_MS = 120_000;

/**
 * Generate a reply using Ollama chat model with KB context injected as system prompt.
 */
export async function generateReply(
  systemPrompt: string,
  userMessage: string,
  kbContext: string,
): Promise<string> {
  const config = getConfig();
  const url = `${config.OLLAMA_BASE_URL}/api/chat`;

  const fullSystemPrompt = kbContext
    ? `${systemPrompt}\n\n以下是相關知識庫內容，請根據這些內容回答客戶問題：\n${kbContext}`
    : systemPrompt;

  const messages: ChatMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_CHAT_MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 500,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Ollama chat failed (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    const text = data.message?.content?.trim();

    if (!text) {
      throw new Error('Ollama returned empty chat response');
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * CRM customer service system prompt (used for auto-reply and suggest).
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
 * System prompt for conversation summarization.
 */
export const SUMMARIZE_SYSTEM_PROMPT =
  '你是一位客服系統的對話分析助手。請根據以下對話記錄，用繁體中文產生簡潔的對話摘要。' +
  '摘要應包含：客戶的主要問題或需求、目前的處理狀態、以及後續建議的行動。' +
  '請用 2-4 句話完成摘要，不要超過 200 字。';
