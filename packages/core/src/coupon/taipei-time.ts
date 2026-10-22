/**
 * 券的日期一律以台灣時間計算（add-coupon-system design D17）。台灣沒有日光節約時間，固定 UTC+8。
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' 且是真實存在的日期時原樣回傳，否則 null */
export function parseDateOnly(value: string): string | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value ? value : null;
}

/** 這個時間點在台灣是哪一天（YYYY-MM-DD） */
export function taipeiDateString(at: Date): string {
  return new Date(at.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 台灣時間該日 00:00 */
export function taipeiDateStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - TAIPEI_OFFSET_MS);
}

/** 台灣時間該日 23:59:59.999 */
export function taipeiDateEnd(date: string): Date {
  return new Date(taipeiDateStart(date).getTime() + DAY_MS - 1);
}

/** 領取後 N 天到期：領取當天（台灣日期）加 N 天，當天結束時到期 */
export function afterClaimExpiry(claimedAt: Date, days: number): Date {
  const start = taipeiDateStart(taipeiDateString(claimedAt));
  return new Date(start.getTime() + (days + 1) * DAY_MS - 1);
}
