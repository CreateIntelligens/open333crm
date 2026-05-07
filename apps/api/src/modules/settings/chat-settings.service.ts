/**
 * Chat Settings Service
 *
 * Per-tenant chat / RAG configuration: provider, model, generation params,
 * and system prompts. Used by llm.service.ts and ai.service.ts.
 */

import type { PrismaClient } from '@prisma/client';
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
  clarifyThreshold: number;
  clarifyMaxAttempts: number;
  handoffOnNegativeSentiment: boolean;
  negativeSentimentThreshold: number;
  sentimentTriggersHandoff: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  baseUrl: 'http://localhost:11434',
  temperature: 0.3,
  maxTokens: 500,
  chatSystemPrompt: '',
  summarizeSystemPrompt: '',
  clarifySystemPrompt: '',
  clarifyThreshold: 0.5,
  clarifyMaxAttempts: 2,
  handoffOnNegativeSentiment: true,
  negativeSentimentThreshold: 0.6,
  sentimentTriggersHandoff: false,
};

export async function getChatSettings(
  prisma: PrismaClient,
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
    clarifyThreshold: s.clarifyThreshold,
    clarifyMaxAttempts: s.clarifyMaxAttempts,
    handoffOnNegativeSentiment: s.handoffOnNegativeSentiment,
    negativeSentimentThreshold: s.negativeSentimentThreshold,
    sentimentTriggersHandoff: s.sentimentTriggersHandoff,
  };
}

export async function updateChatSettings(
  prisma: PrismaClient,
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
      clarifyThreshold: next.clarifyThreshold,
      clarifyMaxAttempts: next.clarifyMaxAttempts,
      handoffOnNegativeSentiment: next.handoffOnNegativeSentiment,
      negativeSentimentThreshold: next.negativeSentimentThreshold,
      sentimentTriggersHandoff: next.sentimentTriggersHandoff,
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
      clarifyThreshold: updated.clarifyThreshold,
      clarifyMaxAttempts: updated.clarifyMaxAttempts,
      handoffOnNegativeSentiment: updated.handoffOnNegativeSentiment,
      negativeSentimentThreshold: updated.negativeSentimentThreshold,
      sentimentTriggersHandoff: updated.sentimentTriggersHandoff,
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
): Promise<ChatProviderHealth> {
  const provider = getChatProvider(providerId);
  return provider.health({ baseUrl, model });
}

export function getProviderList(): { id: string; label: string }[] {
  return listChatProviders();
}
