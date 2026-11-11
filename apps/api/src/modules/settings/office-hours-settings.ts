/**
 * 營業時間設定的 schema（主規格 office-hours-settings「營業時間的輸入檢查」）。
 * 路由檢查輸入，service 解析已存的設定，兩者用同一份。
 */
import { z } from "zod/v3";

/** HH:mm，00:00～23:59 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** YYYY-MM-DD，而且是存在的日期（2026-02-30 不合法，2028-02-29 合法） */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * 以 isWithinOfficeHours() 換算時間用的同一個 API 檢查：通過檢查的時區，換算時不會拋錯。
 * Intl.supportedValuesOf('timeZone') 不含 UTC 等別名，不用它比對。
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const timeSchema = z.string().regex(TIME_PATTERN, "時間格式應為 HH:mm（00:00～23:59）");

const dayScheduleSchema = z
  .object({ start: timeSchema, end: timeSchema })
  // 時間格式不合法時，上面已經指出 start、end，這裡不再重複
  .refine((d) => !TIME_PATTERN.test(d.start) || !TIME_PATTERN.test(d.end) || d.end > d.start, {
    message: "結束時間必須晚於開始時間（不支援跨過午夜）",
  })
  .nullable();

export const MAX_HOLIDAYS = 366;
export const MAX_OUTSIDE_HOURS_MESSAGE_LENGTH = 1000;
export const DEFAULT_OUTSIDE_HOURS_MESSAGE = "您好！目前為非營業時間，我們將在營業時間內盡速回覆您。";

export const officeHoursSettingsSchema = z.object({
  timezone: z.string().max(64).refine(isValidTimeZone, "時區不正確").default("Asia/Taipei"),
  officeHours: z.object({
    enabled: z.boolean(),
    schedule: z.object({
      mon: dayScheduleSchema.optional(),
      tue: dayScheduleSchema.optional(),
      wed: dayScheduleSchema.optional(),
      thu: dayScheduleSchema.optional(),
      fri: dayScheduleSchema.optional(),
      sat: dayScheduleSchema.optional(),
      sun: dayScheduleSchema.optional(),
    }),
    holidays: z
      .array(z.string().refine(isCalendarDate, "日期格式應為 YYYY-MM-DD，且是存在的日期"))
      .max(MAX_HOLIDAYS, `假日最多 ${MAX_HOLIDAYS} 筆`)
      .default([]),
    outsideHoursMessage: z
      .string()
      .min(1, "非營業時間的訊息不可空白")
      .max(MAX_OUTSIDE_HOURS_MESSAGE_LENGTH, `非營業時間的訊息不可超過 ${MAX_OUTSIDE_HOURS_MESSAGE_LENGTH} 字`)
      .default(DEFAULT_OUTSIDE_HOURS_MESSAGE),
  }),
});

export type OfficeHoursSettings = z.infer<typeof officeHoursSettingsSchema>;
export type OfficeHoursConfig = OfficeHoursSettings["officeHours"];

/** 租戶沒有設定，或已存的設定不合法時的值。`enabled` 是 false，所以不送非營業時間的自動回覆 */
const DEFAULT_OFFICE_HOURS_SETTINGS: OfficeHoursSettings = {
  timezone: "Asia/Taipei",
  officeHours: {
    enabled: false,
    schedule: {
      mon: { start: "09:00", end: "18:00" },
      tue: { start: "09:00", end: "18:00" },
      wed: { start: "09:00", end: "18:00" },
      thu: { start: "09:00", end: "18:00" },
      fri: { start: "09:00", end: "18:00" },
      sat: null,
      sun: null,
    },
    holidays: [],
    outsideHoursMessage: DEFAULT_OUTSIDE_HOURS_MESSAGE,
  },
};

export function defaultOfficeHoursSettings(): OfficeHoursSettings {
  return structuredClone(DEFAULT_OFFICE_HOURS_SETTINGS);
}

/**
 * 解析 TenantSettings 已存的 timezone 與 officeHours（主規格 office-hours-settings「已存的營業時間不合法時當作沒有設定」）。
 * 任一個不合法（例如 schema 預設的 `{}`，或加上檢查前存入的不合法時區）就整份回傳預設值：
 * 只換掉時區會用成員沒選的時區判斷營業時間，停用自動回覆不會送錯訊息給客人。
 */
export function readOfficeHoursSettings(row: { timezone: unknown; officeHours: unknown }): OfficeHoursSettings {
  const parsed = officeHoursSettingsSchema.safeParse({ timezone: row.timezone, officeHours: row.officeHours });
  return parsed.success ? parsed.data : defaultOfficeHoursSettings();
}
