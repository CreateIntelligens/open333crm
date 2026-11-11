/**
 * 素材網址欄位裡的站內路徑（/ 開頭、不是 //）換成公開網址（spec material-system
 * 「FB 素材儲存時把站內路徑換成公開網址」「FB 素材發送時把站內路徑換成公開網址」）。
 *
 * 編輯器預設的示範圖是 web 公開提供的站內路徑（/material-samples/...）；Facebook 只收完整網址。
 * 只換網址欄位（欄位名稱以 url 結尾，例如 url、mediaUrl、image_url）裡「整個值就是站內路徑」的字串，
 * 文字欄位與完整網址原樣保留。
 */

const URL_KEY = /url$/i;

/** 是否為站內路徑：/ 開頭、不是 // 開頭（// 是省略協定的外部網址） */
export function isSitePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * @param value 素材 body（或其中一部分）
 * @param baseUrl 公開網址（例如 WEB_BASE_URL）；結尾的 / 會去掉
 * @param shouldResolve 只換符合條件的站內路徑；預設全部站內路徑都換
 * @returns 換好的新物件，不改動傳入的值
 */
export function resolveSitePathUrls<T>(
  value: T,
  baseUrl: string,
  shouldResolve: (path: string) => boolean = () => true,
): T {
  const base = baseUrl.replace(/\/+$/, '');
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      return URL_KEY.test(key) && isSitePath(v) && shouldResolve(v) ? `${base}${v}` : v;
    }
    if (Array.isArray(v)) return v.map((item) => walk(item, key));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, walk(child, k)]));
    }
    return v;
  };
  return walk(value, '') as T;
}

/** 網址欄位裡第一個站內路徑；沒有時回 null（用在沒有公開網址可換時說明原因） */
export function findSitePathUrl(value: unknown, key = ''): string | null {
  if (typeof value === 'string') return URL_KEY.test(key) && isSitePath(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSitePathUrl(item, key);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, child] of Object.entries(value)) {
      const found = findSitePathUrl(child, k);
      if (found) return found;
    }
  }
  return null;
}
