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
  '你是一位專業、友善的客服助手。你必須全程使用繁體中文回覆，絕對不要使用簡體中文或其他語言。' +
  '請根據對話內容，用簡潔清晰的繁體中文回答客戶的問題。' +
  '如果你無法確定答案，請誠實告知並建議客戶聯繫真人客服。' +
  '回覆請保持禮貌、專業，不要編造資訊。';

/**
 * System prompt for conversation summarization.
 */
export const SUMMARIZE_SYSTEM_PROMPT =
  '你是一位客服系統的對話分析助手。請根據以下對話記錄，用繁體中文產生簡潔的對話摘要。' +
  '摘要應包含：客戶的主要問題或需求、目前的處理狀態、以及後續建議的行動。' +
  '請用 2-4 句話完成摘要，不要超過 200 字。';
