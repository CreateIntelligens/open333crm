/**
 * 數值欄位的邊界常數與共用 zod schema。
 *
 * 為什麼需要：Prisma 的 `Int` 對應 PostgreSQL 的 int4，範圍是
 * -2,147,483,648 ~ 2,147,483,647。zod 的 `.int()` 只檢查「是不是整數」，
 * 不檢查「放不放得進 int4」——超出範圍的值會一路送到 Prisma，
 * 由資料庫拒收並拋出未攔截例外 → 500。
 *
 * Wave 6 實測：
 * - `POST /sla-policies` 帶 `firstResponseMinutes: 2147483648`（上限+1）→ 500
 *   （2147483647 可正常存入，確認就是 int4 邊界）
 * - 門戶積分 `amount: 999999999999999` → 500
 *
 * 正確行為是回 400 並告知上限，而不是 500。
 */
import { z } from 'zod';

/** PostgreSQL int4 上下限（Prisma 的 Int） */
export const INT4_MAX = 2_147_483_647;
export const INT4_MIN = -2_147_483_648;

/**
 * 可存進 Int 欄位的整數。
 * 允許負數（例如積分可以是扣點），只擋溢位。
 */
export const int4Schema = z
  .number({ invalid_type_error: '必須是數字' })
  .int('必須是整數')
  .min(INT4_MIN, `數值不可小於 ${INT4_MIN}`)
  .max(INT4_MAX, `數值不可大於 ${INT4_MAX}`);

/**
 * 正整數版本（時限、數量這類不該為 0 或負數的欄位）。
 */
export const positiveInt4Schema = z
  .number({ invalid_type_error: '必須是數字' })
  .int('必須是整數')
  .positive('必須大於 0')
  .max(INT4_MAX, `數值不可大於 ${INT4_MAX}`);

/**
 * SLA 時限專用：分鐘數。
 *
 * 上限刻意設得比 int4 小很多——SLA 時限以「分鐘」為單位，
 * 525600 分鐘 = 365 天，已遠超任何合理的服務水準承諾。
 * 讓使用者填 2147483647 分鐘（約 4083 年）在語意上毫無意義，
 * 不如在明顯不合理處就擋下並給出可理解的訊息。
 */
export const MAX_SLA_MINUTES = 525_600;

export const slaMinutesSchema = z
  .number({ invalid_type_error: '必須是數字' })
  .int('必須是整數')
  .positive('必須大於 0')
  .max(MAX_SLA_MINUTES, `時限不可超過 ${MAX_SLA_MINUTES} 分鐘（365 天）`);
