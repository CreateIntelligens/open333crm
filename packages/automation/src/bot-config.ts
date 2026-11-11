/**
 * 渠道的機器人設定（channel.settings.botConfig）。api 的自動化訂閱者與 KB 自動回覆共用
 * （change outbox-event-delivery，AUDIT ARCH-02：原本放在 api 的 automation.worker.ts）。
 *
 * botConfig 是 JSON 欄位，資料庫不檢查型別（issue #405）。入口（channel 模組）以 botConfigSchema 驗證新值，
 * 不合法回 400；讀取一律經過 getBotConfig()，入口驗證之前存進去的舊值不合法時改用該欄位的預設值。
 * 兩邊共用同一份定義，規則只寫在這裡（比照 apps/api/src/modules/portal/portal-settings.ts）。
 */
import { z } from 'zod/v3';

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

/** Bot 最大回覆次數：與設定畫面的範圍一致（G04，原本後端不驗，可存 9999） */
export const MAX_BOT_REPLIES_RANGE = { min: 1, max: 50 } as const;

/** 快速回覆按鈕的文字上限：與設定畫面的 maxLength 相同（LINE quick reply label 最多 20 字） */
export const HANDOFF_BUTTON_LABEL_MAX = 20;

const BOT_MODES = ['keyword', 'llm', 'keyword_then_llm', 'off'] as const;
const HANDOFF_PROMPT_STYLES = ['text', 'button', 'both', 'none'] as const;

const botModeSchema = z.enum(BOT_MODES, {
  errorMap: () => ({ message: 'Bot 模式必須是 keyword、llm、keyword_then_llm 或 off' }),
});

const maxBotRepliesSchema = z
  .number({ invalid_type_error: 'Bot 最大回覆次數必須是數字' })
  .int(`Bot 最大回覆次數須為 ${MAX_BOT_REPLIES_RANGE.min}～${MAX_BOT_REPLIES_RANGE.max} 的整數`)
  .min(MAX_BOT_REPLIES_RANGE.min, `Bot 最大回覆次數須為 ${MAX_BOT_REPLIES_RANGE.min}～${MAX_BOT_REPLIES_RANGE.max} 的整數`)
  .max(MAX_BOT_REPLIES_RANGE.max, `Bot 最大回覆次數須為 ${MAX_BOT_REPLIES_RANGE.min}～${MAX_BOT_REPLIES_RANGE.max} 的整數`);

/** 空白的關鍵字一定不能用：`text.includes('')` 恆為 true，每則訊息都會轉接 */
const handoffKeywordSchema = z
  .string({ invalid_type_error: '轉接關鍵字必須是文字' })
  .refine((keyword) => keyword.trim().length > 0, '轉接關鍵字不可為空白');

const handoffKeywordsSchema = z.array(handoffKeywordSchema, { invalid_type_error: '轉接關鍵字必須是陣列' });

/** 設定畫面允許清空轉接訊息，所以入口接受空字串；讀取時空白改用預設訊息 */
const handoffMessageSchema = z.string({ invalid_type_error: '轉接訊息必須是文字' });

const offlineGreetingSchema = z.string({ invalid_type_error: '非營業時間招呼語必須是文字' });

const handoffPromptEnabledSchema = z.boolean({ invalid_type_error: '是否顯示轉接提示必須是 true 或 false' });

const handoffPromptStyleSchema = z.enum(HANDOFF_PROMPT_STYLES, {
  errorMap: () => ({ message: '轉接提示樣式必須是 text、button、both 或 none' }),
});

const handoffButtonLabelSchema = z
  .string({ invalid_type_error: '轉接按鈕文字必須是文字' })
  .max(HANDOFF_BUTTON_LABEL_MAX, `轉接按鈕文字不可超過 ${HANDOFF_BUTTON_LABEL_MAX} 字`);

/**
 * 入口驗證用。每個欄位都可省略（省略時讀取用預設值）；其他鍵照舊接受、原樣存放，
 * 程式不讀它們，改成 strict 會讓存了其他鍵的既有渠道無法編輯。
 */
export const botConfigSchema = z
  .object({
    botMode: botModeSchema.optional(),
    maxBotReplies: maxBotRepliesSchema.optional(),
    handoffKeywords: handoffKeywordsSchema.optional(),
    handoffMessage: handoffMessageSchema.optional(),
    offlineGreeting: offlineGreetingSchema.optional(),
    handoffPromptEnabled: handoffPromptEnabledSchema.optional(),
    handoffPromptStyle: handoffPromptStyleSchema.optional(),
    handoffButtonLabel: handoffButtonLabelSchema.optional(),
  }, { invalid_type_error: '機器人設定必須是物件' })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/** 不空白的字串，否則 undefined */
function nonBlank(schema: z.ZodType<string>, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success && result.data.trim().length > 0 ? result.data : undefined;
}

/**
 * 轉接關鍵字：是陣列時只留下不空白的字串（保住管理員設定的其他關鍵字），不是陣列時用預設關鍵字。
 */
function readHandoffKeywords(value: unknown): string[] {
  if (value === undefined || value === null) return [...DEFAULT_BOT_CONFIG.handoffKeywords];
  if (!Array.isArray(value)) return [...DEFAULT_BOT_CONFIG.handoffKeywords];
  return value.filter((keyword): keyword is string => handoffKeywordSchema.safeParse(keyword).success);
}

/**
 * 從渠道的 settings 讀出機器人設定。沒有設定或不合法的欄位用預設值，不丟例外
 * （bot-handoff-config「讀取機器人設定時不合法的值改用預設值」）。
 */
export function getBotConfig(settings: unknown): BotConfig {
  const raw = isRecord(settings) && isRecord(settings.botConfig) ? settings.botConfig : {};
  const config: BotConfig = {
    botMode: pick(botModeSchema, raw.botMode, DEFAULT_BOT_CONFIG.botMode),
    maxBotReplies: pick(maxBotRepliesSchema, raw.maxBotReplies, DEFAULT_BOT_CONFIG.maxBotReplies),
    handoffKeywords: readHandoffKeywords(raw.handoffKeywords),
    handoffMessage: nonBlank(handoffMessageSchema, raw.handoffMessage) ?? DEFAULT_BOT_CONFIG.handoffMessage,
    handoffPromptEnabled: pick(handoffPromptEnabledSchema, raw.handoffPromptEnabled, DEFAULT_BOT_CONFIG.handoffPromptEnabled),
    handoffPromptStyle: pick(handoffPromptStyleSchema, raw.handoffPromptStyle, DEFAULT_BOT_CONFIG.handoffPromptStyle),
    handoffButtonLabel: nonBlank(handoffButtonLabelSchema, raw.handoffButtonLabel) ?? DEFAULT_BOT_CONFIG.handoffButtonLabel,
  };
  const offlineGreeting = nonBlank(offlineGreetingSchema, raw.offlineGreeting);
  if (offlineGreeting !== undefined) config.offlineGreeting = offlineGreeting;
  return config;
}


export function shouldRunAgentReply(botMode: BotConfig['botMode']): boolean {
  return botMode === 'llm' || botMode === 'keyword_then_llm';
}
