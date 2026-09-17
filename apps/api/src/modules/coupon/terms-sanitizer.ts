/**
 * 使用條款的 HTML 消毒（OpenSpec design D9）。
 *
 * 條款需支援斷行、連結、粗體與清單，純文字不敷使用；但這是系統既有的
 * 「一律全 escape」慣例之外的新安全面，因此：
 *
 * 1. 用成熟 sanitizer（sanitize-html）走白名單，**不可自行以正則實作** ——
 *    正則式的 HTML 過濾幾乎必然有繞過方式。
 * 2. 消毒在伺服器端做，儲存時消毒一次，不信任前端送來的內容。
 * 3. 顧客端輸出消毒後的結果時不再二次轉義，否則標記會變成可見文字。
 */
import sanitizeHtml from 'sanitize-html';

/** 條款只需要排版與連結，不需要任何結構或樣式標記。 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a'];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // 只留連結目標；class/style/id 一律不留，避免夾帶樣式或被 CSS 選取器攻擊
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  // 僅允許安全協議 —— 這道防線擋掉 javascript: 與 data: URI
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // 移除整個元素與其內容（預設只移除標籤、保留內文，會把 script 內容變成可見文字）
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe'],
  transformTags: {
    // 外開連結補 noopener：無此屬性時目標頁可透過 window.opener 操作原頁
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
    }),
  },
};

/**
 * 消毒使用條款。回傳可安全存入 DB 並直接輸出至顧客端的 HTML。
 * 空值回傳 null，讓「沒有條款」與「條款是空字串」在 DB 中一致。
 */
export function sanitizeTerms(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = sanitizeHtml(raw, OPTIONS).trim();
  return cleaned.length > 0 ? cleaned : null;
}
