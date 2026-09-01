/**
 * Chat Settings Service
 *
 * Per-tenant chat / RAG configuration: provider, model, generation params,
 * and system prompts. Used by llm.service.ts and ai.service.ts.
 */

import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { getChatProvider, listChatProviders } from '../ai/providers/index.js';
import type { ChatModelInfo, ChatProviderHealth } from '../ai/providers/index.js';

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

export async function getChatSettings(
  prisma: TenantDb,
  tenantId: string,
): Promise<ChatSettings> {
  let s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (!s) {
    s = await prisma.tenantSettings.create({ data: { tenantId } });
  }
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

export async function updateChatSettings(
  prisma: TenantDb,
  tenantId: string,
  patch: Partial<ChatSettings>,
): Promise<{ settings: ChatSettings; providerChanged: boolean; previousProvider: string }> {
  const current = await getChatSettings(prisma, tenantId);
  const next: ChatSettings = { ...current, ...patch };
  const providerChanged = patch.provider !== undefined && patch.provider !== current.provider;

  const updated = await prisma.tenantSettings.update({
    where: { tenantId },
    data: {
      chatProvider: next.provider,
      chatModel: next.model,
      chatBaseUrl: next.baseUrl,
      chatTemperature: next.temperature,
      chatMaxTokens: next.maxTokens,
      chatSystemPrompt: next.chatSystemPrompt,
      summarizeSystemPrompt: next.summarizeSystemPrompt,
      clarifySystemPrompt: next.clarifySystemPrompt,
      modelGuideSystemPrompt: next.modelGuideSystemPrompt,
      clarifyThreshold: next.clarifyThreshold,
      clarifyMaxAttempts: next.clarifyMaxAttempts,
    },
  });

  return {
    settings: {
      provider: updated.chatProvider as ChatSettings['provider'],
      model: updated.chatModel,
      baseUrl: updated.chatBaseUrl,
      temperature: updated.chatTemperature,
      maxTokens: updated.chatMaxTokens,
      chatSystemPrompt: updated.chatSystemPrompt,
      summarizeSystemPrompt: updated.summarizeSystemPrompt,
      clarifySystemPrompt: updated.clarifySystemPrompt,
      modelGuideSystemPrompt: updated.modelGuideSystemPrompt,
      clarifyThreshold: updated.clarifyThreshold,
      clarifyMaxAttempts: updated.clarifyMaxAttempts,
    },
    providerChanged,
    previousProvider: current.provider,
  };
}

export async function listChatModels(
  providerId: string,
  baseUrl?: string,
): Promise<ChatModelInfo[]> {
  const provider = getChatProvider(providerId);
  return provider.listModels({ baseUrl });
}

export async function checkChatHealth(
  providerId: string,
  model: string,
  baseUrl?: string,
  apiKey?: string,
): Promise<ChatProviderHealth> {
  const provider = getChatProvider(providerId);
  return provider.health({ baseUrl, model, apiKey });
}

export function getProviderList(): { id: string; label: string }[] {
  return listChatProviders();
}
