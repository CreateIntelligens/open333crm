/**
 * 券相關的日期一律以台灣時間顯示（add-coupon-system design D17），不受瀏覽器時區影響。
 */
const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export interface TaipeiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** 時間點在台灣的年月日時分；無效時回 null */
export function taipeiParts(value: string | Date | null | undefined): TaipeiParts | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = FORMAT.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 台灣日期 YYYY-MM-DD（給 <input type="date">）；無效時回空字串 */
export function taipeiYmd(value: string | Date | null | undefined): string {
  const p = taipeiParts(value);
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : '';
}
