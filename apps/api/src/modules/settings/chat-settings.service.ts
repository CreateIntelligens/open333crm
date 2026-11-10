/**
 * Chat Settings Service
 *
 * Per-tenant chat / RAG configuration: provider, model, generation params,
 * and system prompts. 讀取只讀資料庫，沒有設定列時回 DEFAULT_CHAT_SETTINGS；修改以 upsert 寫入
 * （spec chat-settings，change migrate-ai-llm-tenant-ctx design D5）。呼叫 provider 的函式在 ai/llm-client.ts。
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';

export interface ChatSettings {
  provider: 'ollama' | 'gemini';
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  chatSystemPrompt: string;
  summarizeSystemPrompt: string;
  clarifySystemPrompt: string;
  modelGuideSystemPrompt: string;
  clarifyThreshold: number;
  clarifyMaxAttempts: number;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  baseUrl: 'http://localhost:11434',
  // 客服場景重視回答準確、降低編造，故偏低（原 0.3 → 0.2）
  temperature: 0.2,
  maxTokens: 500,
  chatSystemPrompt: '',
  summarizeSystemPrompt: '',
  clarifySystemPrompt: '',
  modelGuideSystemPrompt: '',
  clarifyThreshold: 0.5,
  clarifyMaxAttempts: 2,
};

type ChatSettingsRow = {
  chatProvider: string;
  chatModel: string;
  chatBaseUrl: string;
  chatTemperature: number;
  chatMaxTokens: number;
  chatSystemPrompt: string;
  summarizeSystemPrompt: string;
  clarifySystemPrompt: string;
  modelGuideSystemPrompt: string;
  clarifyThreshold: number;
  clarifyMaxAttempts: number;
};

function toChatSettings(s: ChatSettingsRow): ChatSettings {
  return {
    provider: (s.chatProvider as ChatSettings['provider']) ?? DEFAULT_CHAT_SETTINGS.provider,
    model: s.chatModel,
    baseUrl: s.chatBaseUrl,
    temperature: s.chatTemperature,
    maxTokens: s.chatMaxTokens,
    chatSystemPrompt: s.chatSystemPrompt,
    summarizeSystemPrompt: s.summarizeSystemPrompt,
    clarifySystemPrompt: s.clarifySystemPrompt,
    modelGuideSystemPrompt: s.modelGuideSystemPrompt,
    clarifyThreshold: s.clarifyThreshold,
    clarifyMaxAttempts: s.clarifyMaxAttempts,
  };
}

function toRowData(s: ChatSettings) {
  return {
    chatProvider: s.provider,
    chatModel: s.model,
    chatBaseUrl: s.baseUrl,
    chatTemperature: s.temperature,
    chatMaxTokens: s.maxTokens,
    chatSystemPrompt: s.chatSystemPrompt,
    summarizeSystemPrompt: s.summarizeSystemPrompt,
    clarifySystemPrompt: s.clarifySystemPrompt,
    modelGuideSystemPrompt: s.modelGuideSystemPrompt,
    clarifyThreshold: s.clarifyThreshold,
    clarifyMaxAttempts: s.clarifyMaxAttempts,
  };
}

/** 只讀：沒有設定列時回預設值，不建立設定列 */
export async function getChatSettings(ctx: TenantCtx): Promise<ChatSettings> {
  const s = await ctx.tx.tenantSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  return s ? toChatSettings(s) : { ...DEFAULT_CHAT_SETTINGS };
}

/** 沒有設定列時建立一列：沒有收到的欄位用預設值 */
export async function updateChatSettings(
  ctx: TenantCtx,
  patch: Partial<ChatSettings>,
): Promise<{ settings: ChatSettings; providerChanged: boolean; previousProvider: string }> {
  const current = await getChatSettings(ctx);
  const next: ChatSettings = { ...current, ...patch };
  const providerChanged = patch.provider !== undefined && patch.provider !== current.provider;

  const updated = await ctx.tx.tenantSettings.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, ...toRowData(next) },
    update: toRowData(next),
  });

  return { settings: toChatSettings(updated), providerChanged, previousProvider: current.provider };
}
