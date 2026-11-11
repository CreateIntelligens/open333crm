/**
 * 渠道 settings.botConfig 的寫入檢查（channel-management「Bot 最大回覆次數的範圍」「機器人設定欄位的型別與範圍」，
 * issue #405）。欄位規則只寫在 @open333crm/automation 的 botConfigSchema，讀取也用同一份（getBotConfig()）。
 */
import { isDeepStrictEqual } from 'node:util';
import { botConfigSchema } from '@open333crm/automation';
import { AppError } from '../../shared/utils/response.js';

export interface BotConfigIssue {
  /** 從 body 算起的路徑，例如 ['settings', 'botConfig', 'handoffKeywords', 1] */
  path: Array<string | number>;
  message: string;
}

/** botConfig 不合法的欄位；沒有設定（undefined、null）時沒有問題 */
export function botConfigIssues(botConfig: unknown): BotConfigIssue[] {
  if (botConfig === undefined || botConfig === null) return [];
  const result = botConfigSchema.safeParse(botConfig);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: ['settings', 'botConfig', ...issue.path],
    message: issue.message,
  }));
}

/**
 * 更新渠道時檢查送出的 botConfig。與已存的相同時不檢查：Downstream Webhook 設定視窗會把整包 settings 原樣送回，
 * 舊資料不合法（例如 G04 之前存進的 maxBotReplies 9999）不能擋住其他設定的修改。
 * 不合法時丟 400 VALIDATION_ERROR，details.issues 的格式與路由的 Zod 錯誤相同。
 */
export function assertBotConfigWritable(nextBotConfig: unknown, storedSettings: unknown): void {
  const stored =
    storedSettings && typeof storedSettings === 'object' ? (storedSettings as Record<string, unknown>).botConfig : undefined;
  if (isDeepStrictEqual(nextBotConfig, stored)) return;
  const issues = botConfigIssues(nextBotConfig);
  if (issues.length === 0) return;
  throw new AppError(
    `機器人設定有誤：${issues.map((issue) => issue.message).join('；')}`,
    'VALIDATION_ERROR',
    400,
    { issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
  );
}
