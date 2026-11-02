/**
 * 把文字訊息拆成純文字與網址片段，供 WebChat 的 widget 與 `/chatbox` 頁面把網址顯示成連結
 * （規格 webchat-widget「Web addresses in text messages are links」）。
 *
 * 只認 `http://` 與 `https://`：其他 scheme（`javascript:`、`data:`）一律維持純文字。
 * 呼叫端以 DOM 節點或 React 元素組出連結，不可把結果當 HTML 字串插入。
 */
export interface TextLinkPart {
  type: 'text' | 'link';
  value: string;
}

/**
 * 網址字元不含空白、引號、角括號，也不含中日韓文字（含假名、韓文）與全形符號：
 * 訊息常把網址直接接在文字或全形標點前，例如「https://ig.me/m/shop點這裡」。
 */
const URL_PATTERN =
  /https?:\/\/[^\s<>"'`ᄀ-ᇿ　-ヿ㄰-㆏㐀-鿿가-힯豈-﫿＀-￯]+/gi;

/** 網址結尾的半形標點多半屬於句子，不屬於網址 */
const TRAILING_PUNCTUATION = /[.,;:!?]$/;
const OPENING_BRACKET: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const countOf = (text: string, char: string) => text.split(char).length - 1;

/**
 * 去掉結尾不屬於網址的標點。結尾括號只在沒有成對的左括號時去掉：
 * 「https://en.wikipedia.org/wiki/Foo_(bar)」的「)」屬於網址，「(https://x.test/p)」的不屬於。
 */
function trimTrailing(url: string): string {
  let result = url;
  for (;;) {
    const last = result.at(-1) ?? '';
    const open = OPENING_BRACKET[last];
    if (TRAILING_PUNCTUATION.test(last) || (open && countOf(result, last) > countOf(result, open))) {
      result = result.slice(0, -1);
    } else {
      return result;
    }
  }
}

export function splitTextLinks(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let textStart = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimTrailing(match[0]);
    // 只有 scheme 沒有主機（例如「https://」）不算網址
    if (!/^https?:\/\/[^/?#]/i.test(url)) continue;
    if (start > textStart) parts.push({ type: 'text', value: text.slice(textStart, start) });
    parts.push({ type: 'link', value: url });
    textStart = start + url.length;
  }

  if (textStart < text.length) parts.push({ type: 'text', value: text.slice(textStart) });
  return parts;
}
