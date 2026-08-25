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
  // BYOK：租戶自備 API key（Gemini 用）；未傳則 provider 退回全域 env
  apiKey?: string;
}

/**
 * 單次呼叫的 token 用量（供計費/額度統計）。
 * 各欄位缺項一律補 0；provider 完全拿不到用量時整個 usage 為 undefined。
 */
export interface TokenUsage {
  /** 輸入 token（含快取命中部分） */
  promptTokens: number;
  /** 輸入中命中 context cache 的部分（promptTokens 的子集） */
  cachedTokens: number;
  /** 模型輸出（回覆本文） */
  candidatesTokens: number;
  /** thinking token（計費上按 output 價） */
  thoughtsTokens: number;
}

export interface ChatGenerateResult {
  text: string;
  usage?: TokenUsage;
}

export interface ChatProvider {
  readonly id: 'ollama' | 'gemini';
  readonly label: string;

  /** Generate a reply. Throws on failure. */
  generate(opts: ChatGenerateOptions): Promise<ChatGenerateResult>;

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
