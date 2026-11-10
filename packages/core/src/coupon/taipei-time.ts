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

/**
 * @description 期間內每一個台灣日期（YYYY-MM-DD），從 from 的台灣日期到 to 的台灣日期，頭尾不足一天也算。
 * 圖表補齊沒有資料的日子時用，時間軸才是連續的。
 * @param from 期間起點
 * @param to 期間終點
 * @param maxDays 最多列幾天；超過時回 null，呼叫端改為只列有資料的日子，避免回應過大
 * @returns 台灣日期陣列；from 晚於 to 時是空陣列；超過 maxDays 時是 null
 */
export function taipeiDatesBetween(from: Date, to: Date, maxDays: number): string[] | null {
  const days: string[] = [];
  for (let d = taipeiDateStart(taipeiDateString(from)); d <= to; d = new Date(d.getTime() + DAY_MS)) {
    if (days.length >= maxDays) return null;
    days.push(taipeiDateString(d));
  }
  return days;
}

/** 這個時間點在台灣是哪個月（YYYY-MM）。AI 月額度的計數器與告警以這個月份為準 */
export function taipeiMonthString(at: Date): string {
  return taipeiDateString(at).slice(0, 7);
}

/** 這個時間點所在台灣月份的 1 日 00:00 */
export function taipeiMonthStart(at: Date): Date {
  return taipeiDateStart(`${taipeiMonthString(at)}-01`);
}

/** 這個時間點所在台灣月份的下個月 1 日 00:00 */
export function taipeiNextMonthStart(at: Date): Date {
  const [y, m] = taipeiMonthString(at).split('-').map(Number);
  // Date.UTC 的月份從 0 起算，傳入 m 就是下個月；12 月會自動進位到隔年 1 月
  return new Date(Date.UTC(y, m, 1) - TAIPEI_OFFSET_MS);
}

/** 領取後 N 天到期：領取當天（台灣日期）加 N 天，當天結束時到期 */
export function afterClaimExpiry(claimedAt: Date, days: number): Date {
  const start = taipeiDateStart(taipeiDateString(claimedAt));
  return new Date(start.getTime() + (days + 1) * DAY_MS - 1);
}
