import type { ChatProvider } from './types.js';
import { OllamaChatProvider } from './ollama.provider.js';
import { GeminiChatProvider } from './gemini.provider.js';

export type {
  ChatProvider,
  ChatGenerateOptions,
  ChatModelInfo,
  ChatProviderHealth,
  HistoryMessage,
  AgentMessage,
  JsonSchema,
  ToolCall,
  ToolDefinition,
  ToolTurnOptions,
  ToolTurnResult,
} from './types.js';

const PROVIDERS: Record<string, ChatProvider> = {
  ollama: OllamaChatProvider,
  gemini: GeminiChatProvider,
};

export function getChatProvider(id: string): ChatProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown chat provider: ${id}`);
  return p;
}

export function listChatProviders(): { id: string; label: string }[] {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }));
}
