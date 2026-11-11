/**
 * 關鍵字規則的比對（change outbox-event-delivery：automation-engine「關鍵字的比對結果一致」）。
 *
 * AI 是否讓步與 workers 執行關鍵字規則都呼叫這個函式，對同一則訊息得出相同的命中結果。
 * 存檔資料可能有非字串或空白的關鍵字（加上存檔驗證之前的資料）；空字串會命中所有訊息，一併排除。
 */
export interface KeywordMatch {
  matchedKeywords: string[];
  matchMode: 'any' | 'all';
}

/** trigger 是規則的 trigger 欄位；不是 keyword.matched、或沒有命中時回傳 null。比對不分大小寫 */
export function matchKeywordTrigger(trigger: unknown, text: string): KeywordMatch | null {
  if (!text || !trigger || typeof trigger !== 'object') return null;
  const t = trigger as Record<string, unknown>;
  if (t.type !== 'keyword.matched') return null;
  const keywords = Array.isArray(t.keywords)
    ? t.keywords.filter((kw): kw is string => typeof kw === 'string' && kw.trim().length > 0)
    : [];
  if (keywords.length === 0) return null;

  const matchMode = t.match_mode === 'all' ? 'all' : 'any';
  const lowerText = text.toLowerCase();
  const matchedKeywords = keywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
  const matched = matchMode === 'all' ? matchedKeywords.length === keywords.length : matchedKeywords.length > 0;
  return matched ? { matchedKeywords, matchMode } : null;
}
