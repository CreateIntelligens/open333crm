/**
 * LINE 素材儲存前把內建示範圖換成公開網址（spec material-system「LINE 素材儲存時把示範圖換成公開網址」）。
 *
 * 編輯器預設帶入的示範圖是站內路徑（/material-samples/...，由 web 公開提供），LINE 只收 https 公開網址。
 * 只換「整個值就是示範圖路徑」的字串；使用者自己的網址與其他站內路徑原樣保留。
 */
import { getApiPublicUrl } from '../storage/storage.service.js';

const SAMPLE_PREFIX = '/material-samples/';
/** 圖文訊息舊的示範底圖：靜態 jpeg 沒有 LINE 要的 baseUrl/{寬度}，換成 API 的示範底圖端點 */
const OLD_IMAGEMAP_SAMPLE = `${SAMPLE_PREFIX}promo-banner.jpeg`;

/** web 的公開網址。與 getApiPublicUrl() 一樣直接讀環境變數，預設值同 config/env.ts 的 WEB_BASE_URL */
function webBaseUrl(): string {
  return (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function resolveValue(value: unknown, base: string): unknown {
  if (typeof value === 'string') {
    return value.startsWith(SAMPLE_PREFIX) ? `${base}${value}` : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, base));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, base)]));
  }
  return value;
}

/**
 * @returns 示範圖換成公開網址後的新 body；不是 LINE 版型時原樣回傳
 */
export function resolveLineSampleImageUrls(
  contentType: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!contentType.startsWith('line_')) return body;
  const base = webBaseUrl();
  const resolved = resolveValue(body, base) as Record<string, unknown>;
  if (
    contentType === 'line_imagemap' &&
    (resolved.baseImageUrl === `${base}${OLD_IMAGEMAP_SAMPLE}` || body.baseImageUrl === OLD_IMAGEMAP_SAMPLE)
  ) {
    resolved.baseImageUrl = `${getApiPublicUrl()}/line-imagemap/demo`;
  }
  return resolved;
}
