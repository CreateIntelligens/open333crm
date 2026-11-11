/**
 * 活動設定（PortalActivity.settings）中會影響規則的欄位（主規格 portal-activity）。
 *
 * settings 是 JSON 欄位，資料庫不檢查型別。入口（portal.routes.ts）以 activitySettingsSchema 驗證，
 * 不合法的值回 400；service 以 readActivitySettings() 讀取，入口驗證之前存進去的舊值不合法時改用安全的預設值。
 * 兩邊共用同一份定義，規則只寫在這裡。
 */
import { z } from 'zod/v3';
import { INT4_MAX } from '../../shared/utils/numeric-bounds.js';

const allowMultipleSchema = z.boolean({ invalid_type_error: '是否允許重複參加必須是 true 或 false' });

const pointsPerSubmitSchema = z
  .number({ invalid_type_error: '每次參加的積分必須是數字' })
  .int('每次參加的積分必須是整數')
  .min(0, '每次參加的積分不可為負數')
  .max(INT4_MAX, `每次參加的積分不可大於 ${INT4_MAX}`);

/**
 * 其他欄位照舊接受，原樣存起來（AGENTS.md Conventions 的 Validation：只存放、不讀取的值）。
 * 程式只讀 allowMultiple 與 pointsPerSubmit。既有的活動可能存了其他欄位，改成 strict 的話，
 * 編輯這些活動時會回 400。
 */
export const activitySettingsSchema = z
  .object({
    allowMultiple: allowMultipleSchema.optional(),
    pointsPerSubmit: pointsPerSubmitSchema.optional(),
  })
  .passthrough();

export interface ActivityRules {
  /** 同一位粉絲能不能參加多次 */
  allowMultiple: boolean;
  /** 每次參加給的積分 */
  pointsPerSubmit: number;
}

/**
 * 讀取活動設定。欄位不合法時採用安全的預設值：不允許重複參加、不給積分。
 * 不讓舊資料的負數扣掉粉絲的積分，也不讓字串讓整個活動送不出。
 */
export function readActivitySettings(raw: unknown): ActivityRules {
  const settings = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const allowMultiple = allowMultipleSchema.safeParse(settings.allowMultiple);
  const pointsPerSubmit = pointsPerSubmitSchema.safeParse(settings.pointsPerSubmit);
  return {
    allowMultiple: allowMultiple.success && allowMultiple.data,
    pointsPerSubmit: pointsPerSubmit.success ? pointsPerSubmit.data : 0,
  };
}
