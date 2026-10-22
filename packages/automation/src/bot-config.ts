/**
 * 渠道的機器人設定（channel.settings.botConfig）。api 的自動化訂閱者與 KB 自動回覆共用
 * （change outbox-event-delivery，AUDIT ARCH-02：原本放在 api 的 automation.worker.ts）。
 */
export type HandoffPromptStyle = 'text' | 'button' | 'both' | 'none';

export interface BotConfig {
  botMode: 'keyword' | 'llm' | 'keyword_then_llm' | 'off';
  maxBotReplies: number;
  handoffKeywords: string[];
  handoffMessage: string;
  offlineGreeting?: string;
  handoffPromptEnabled: boolean;
  handoffPromptStyle: HandoffPromptStyle;
  handoffButtonLabel: string;
}

export const DEFAULT_HANDOFF_PROMPT_TEXT =
  '需要真人客服協助嗎？請輸入「真人」或「客服」即可轉接。';

export const DEFAULT_BOT_CONFIG: BotConfig = {
  botMode: 'keyword_then_llm',
  maxBotReplies: 5,
  handoffKeywords: ['真人', '人工', '客服', '轉接'],
  handoffMessage: '稍等，正在為您轉接客服人員',
  handoffPromptEnabled: true,
  handoffPromptStyle: 'button',
  handoffButtonLabel: '💬 轉接客服',
};


/** 從渠道的 settings 讀出機器人設定，沒有設定的欄位用預設值 */
export function getBotConfig(settings: unknown): BotConfig {
  const channelSettings = (settings || {}) as Record<string, unknown>;
  const rawBotConfig = (channelSettings.botConfig || {}) as Partial<BotConfig>;
  return { ...DEFAULT_BOT_CONFIG, ...rawBotConfig };
}


export function shouldRunAgentReply(botMode: BotConfig['botMode']): boolean {
  return botMode === 'llm' || botMode === 'keyword_then_llm';
}
