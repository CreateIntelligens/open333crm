// 台灣沒有日光節約時間，固定 UTC+8
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @description 用量統計「近 N 天」的查詢區間：從台灣今天往前 N−1 天的 00:00 到現在。
 * 每日趨勢以台灣日期分日，這樣剛好 N 格；總覽、排行與鑽取共用同一個區間，加總才一致。
 * @param days 天數（含今天）
 * @param now 現在時間
 * @returns ISO 字串的 from、to
 */
export function usageRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const taipeiTodayStart = Math.floor((now.getTime() + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
  const from = new Date(taipeiTodayStart - (days - 1) * DAY_MS);
  return { from: from.toISOString(), to: now.toISOString() };
}
