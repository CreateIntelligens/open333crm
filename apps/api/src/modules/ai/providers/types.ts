/**
 * Chat Provider abstraction
 *
 * All chat providers (Ollama, Gemini, future: OpenAI/Anthropic) implement
 * this interface. The provider is selected per-tenant via TenantSettings.chatProvider.
 */

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatGenerateOptions {
  systemPrompt: string;
  /** Latest user turn (will be appended after history). */
  userMessage: string;
  kbContext?: string;
  /** Prior conversation turns (oldest → newest), excluding the current userMessage. */
  history?: HistoryMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  // Provider-specific connection (Ollama needs baseUrl; Gemini reads global API key)
  baseUrl?: string;
}

export interface ChatProvider {
  readonly id: 'ollama' | 'gemini';
  readonly label: string;

  /** Generate a reply. Throws on failure. */
  generate(opts: ChatGenerateOptions): Promise<string>;

  /** List available chat-capable models. Returns [] on failure. */
  listModels(opts: { baseUrl?: string }): Promise<ChatModelInfo[]>;

  /** Quick health check — does this provider currently work? */
  health(opts: { baseUrl?: string; model: string }): Promise<ChatProviderHealth>;
}

export interface ChatModelInfo {
  id: string;
  label: string;
  // Optional metadata for display
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  tier?: 'stable' | 'latest' | 'preview' | 'open-source';
}

export interface ChatProviderHealth {
  ok: boolean;
  reachable: boolean;
  modelInstalled: boolean;
  currentModel: string;
  error?: string;
}
