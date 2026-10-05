/** 瀏覽器打得開的網址；排除 `line-content:<id>` 這類後端佔位值與 javascript: 等危險 scheme */
function isOpenableUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(https?:|data:|\/)/i.test(value);
}

/**
 * 訊息內容裡的媒體網址。與 `@open333crm/shared` 的 getMediaUrl 同順序（先 url 再 mediaUrl），
 * 但只採用瀏覽器打得開的網址：issue #206 修正前，LINE 的 mediaUrl 是 `line-content:<id>` 佔位值。
 * 都沒有時，相容把網址或圖片 data URI 直接存成文字的舊資料。
 */
export function extractMediaUrl(content: unknown): string | null {
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if (isOpenableUrl(obj.url)) return obj.url;
    if (isOpenableUrl(obj.mediaUrl)) return obj.mediaUrl;
  }
  const text = typeof content === 'string' ? content : (content as { text?: unknown } | null)?.text;
  if (typeof text === 'string' && (text.startsWith('data:image') || /^https?:/i.test(text))) return text;
  return null;
}

/** 檔案大小：512 B、20 KB、1.5 MB；沒有大小時回空字串 */
export function formatFileSize(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number(value.toFixed(1))} ${units[unit]}`;
}

export type MessageMedia =
  | { kind: 'image' | 'video' | 'audio'; url: string }
  | { kind: 'file'; url: string; fileName: string; sizeLabel: string }
  | { kind: 'text'; error?: string };

/**
 * 訊息泡泡要怎麼顯示媒體。沒有打得開的網址時（還沒下載、下載失敗）顯示文字；
 * 下載失敗時帶上後端寫入的 `mediaError`，讓客服知道不是還在下載。
 */
export function describeMessageMedia(contentType: string, content: unknown): MessageMedia {
  const obj = (typeof content === 'object' && content !== null ? content : {}) as Record<string, unknown>;
  if (!['image', 'video', 'audio', 'file'].includes(contentType)) return { kind: 'text' };

  const url = extractMediaUrl(content);
  if (!url) {
    return typeof obj.mediaError === 'string' && obj.mediaError ? { kind: 'text', error: obj.mediaError } : { kind: 'text' };
  }
  if (contentType === 'file') {
    const fileName = typeof obj.fileName === 'string' && obj.fileName ? obj.fileName : '檔案';
    return { kind: 'file', url, fileName, sizeLabel: formatFileSize(obj.fileSize) };
  }
  return { kind: contentType as 'image' | 'video' | 'audio', url };
}
