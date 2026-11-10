/**
 * LLM 的用戶端：呼叫 Chat provider，不碰資料庫（change migrate-ai-llm-tenant-ctx，design D1）。
 *
 * 呼叫端在交易外呼叫這裡的函式：外部呼叫不能佔住交易（AGENTS.md 結構規則 2）。
 * 這些函式不收 TenantCtx，所以型別擋不住在交易內呼叫，由 code review 把關，同 embedding/embedding-client.ts。
 */
import { getChatProvider, listChatProviders } from './providers/index.js';
import type { ChatModelInfo, ChatProviderHealth, HistoryMessage } from './providers/index.js';
import type { TokenUsage } from './providers/types.js';
import { getPrivacyAwareChatProvider } from './deidentification.service.js';
import type { AiPrivacyPolicy } from '../platform/ai-privacy.service.js';
import type { ChatSettings } from '../settings/chat-settings.service.js';

/** 呼叫哪個模型：租戶的 Chat 設定、這次要用的金鑰與遮罩政策 */
export interface ChatTarget {
  settings: ChatSettings;
  apiKey?: string;
  privacy: AiPrivacyPolicy;
}

export interface ChatRequest {
  /** 已組好的系統提示詞（知識庫內容、其他渠道的訊息都已接上） */
  systemPrompt: string;
  userMessage: string;
  history?: HistoryMessage[];
}

/** 遮罩政策啟用時，系統提示詞、使用者訊息與歷史訊息遮罩後才送出 */
export async function callChatModel(
  target: ChatTarget,
  request: ChatRequest,
): Promise<{ text: string; usage?: TokenUsage }> {
  const provider = getPrivacyAwareChatProvider(target.privacy, getChatProvider(target.settings.provider));
  return provider.generate({
    systemPrompt: request.systemPrompt,
    userMessage: request.userMessage,
    history: request.history,
    model: target.settings.model,
    temperature: target.settings.temperature,
    maxTokens: target.settings.maxTokens,
    baseUrl: target.settings.baseUrl,
    apiKey: target.apiKey,
  });
}

export async function listChatModels(providerId: string, baseUrl?: string): Promise<ChatModelInfo[]> {
  return getChatProvider(providerId).listModels({ baseUrl });
}

export async function checkChatHealth(
  providerId: string,
  model: string,
  baseUrl?: string,
  apiKey?: string,
): Promise<ChatProviderHealth> {
  return getChatProvider(providerId).health({ baseUrl, model, apiKey });
}

export function getProviderList(): { id: string; label: string }[] {
  return listChatProviders();
}
