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
  /**
   * 已組裝完成的完整 system prompt。知識庫約束與內容一律由上層
   * （llm.service 的 buildSystemPrompt）拼好再傳入，provider 不得自行加工——
   * 否則租戶自訂的 chatSystemPrompt 會被蓋掉，且同一段邏輯會在各 provider 重複。
   */
  systemPrompt: string;
  /** Latest user turn (will be appended after history). */
  userMessage: string;
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

export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolName?: string;
}

export interface ToolTurnOptions {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  model: string;
  temperature: number;
  maxTokens: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface ToolTurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

export interface ChatProvider {
  readonly id: 'ollama' | 'gemini';
  readonly label: string;

  /** Generate a reply. Throws on failure. */
  generate(opts: ChatGenerateOptions): Promise<ChatGenerateResult>;

  /** Generate one Agent turn. Tool execution remains the caller's responsibility. */
  generateToolTurn(opts: ToolTurnOptions): Promise<ToolTurnResult>;

  /** List available chat-capable models. Returns [] on failure. */
  listModels(opts: { baseUrl?: string }): Promise<ChatModelInfo[]>;

  /** Quick health check — does this provider currently work? */
  health(opts: { baseUrl?: string; model: string; apiKey?: string }): Promise<ChatProviderHealth>;
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
