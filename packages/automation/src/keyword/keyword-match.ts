/**
 * 關鍵字規則的比對（change outbox-event-delivery：automation-engine「關鍵字的比對結果一致」）。
 *
 * AI 是否讓步與 workers 執行關鍵字規則都呼叫 matchKeywordTrigger()，對同一則訊息得出相同的命中結果。
 * 留言關鍵字自動私訊（change add-comment-keyword-private-reply）也用同一個核心 matchKeywords()，
 * 差別只在正規化方式：關鍵字回覆只轉小寫（維持現狀），留言比對做 NFKC＋小寫。
 * 存檔資料可能有非字串或空白的關鍵字（加上存檔驗證之前的資料）；空字串會命中所有訊息，一併排除。
 */
export interface KeywordMatch {
  matchedKeywords: string[];
  matchMode: 'any' | 'all';
}

/**
 * 比對前的正規化方式：
 * - `lowercase`：只轉小寫（關鍵字回覆，`＋１` 不等於 `+1`）
 * - `nfkc`：NFKC 正規化後轉小寫（留言比對，全形半形視為相同）
 */
export type KeywordNormalize = 'lowercase' | 'nfkc';

/** 依正規化方式轉換文字；關鍵字與訊息都經過同一個函式，存檔時的重複檢查也用它 */
export function normalizeKeywordText(text: string, normalize: KeywordNormalize): string {
  return normalize === 'nfkc' ? text.normalize('NFKC').toLowerCase() : text.toLowerCase();
}

/**
 * 包含比對：any 任一關鍵字出現即命中，all 全部出現才命中。
 * 沒有文字（貼圖留言）或沒有有效關鍵字時回傳 null，不丟錯。matchedKeywords 回傳原始（未正規化）的關鍵字。
 */
export function matchKeywords(
  keywords: readonly unknown[],
  matchMode: 'any' | 'all',
  text: string | null | undefined,
  options: { normalize: KeywordNormalize },
): KeywordMatch | null {
  if (!text) return null;
  const valid = keywords.filter((kw): kw is string => typeof kw === 'string' && kw.trim().length > 0);
  if (valid.length === 0) return null;

  const normalizedText = normalizeKeywordText(text, options.normalize);
  const matchedKeywords = valid.filter((kw) => normalizedText.includes(normalizeKeywordText(kw, options.normalize)));
  const matched = matchMode === 'all' ? matchedKeywords.length === valid.length : matchedKeywords.length > 0;
  return matched ? { matchedKeywords, matchMode } : null;
}

/** trigger 是規則的 trigger 欄位；不是 keyword.matched、或沒有命中時回傳 null。比對不分大小寫（不做 NFKC） */
export function matchKeywordTrigger(trigger: unknown, text: string): KeywordMatch | null {
  if (!text || !trigger || typeof trigger !== 'object') return null;
  const t = trigger as Record<string, unknown>;
  if (t.type !== 'keyword.matched') return null;
  const keywords = Array.isArray(t.keywords) ? t.keywords : [];
  const matchMode = t.match_mode === 'all' ? 'all' : 'any';
  return matchKeywords(keywords, matchMode, text, { normalize: 'lowercase' });
}
