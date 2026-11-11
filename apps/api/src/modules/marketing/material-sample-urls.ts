/**
 * 素材儲存前把站內路徑換成公開網址。
 *
 * - LINE（spec material-system「LINE 素材儲存時只把示範圖換成公開網址」）：只換示範圖（/material-samples/...）。
 *   其他站內路徑原樣保留，由 LINE validate 擋下。
 * - FB（spec material-system「FB 素材儲存時把站內路徑換成公開網址」）：網址欄位裡所有站內路徑都換成
 *   `{WEB_BASE_URL}{路徑}`。Facebook 只收完整網址，站內路徑原樣存檔會讓發送整批失敗（2026-10-27 UAT）。
 *
 * 編輯器預設帶入的示範圖是站內路徑（由 web 公開提供）。只換網址欄位（欄位名稱以 url 結尾，例如 mediaUrl、
 * imageUrl、image_url、previewImageUrl、baseImageUrl、Flex 圖片的 url）裡「整個值就是站內路徑」的字串；
 * 文字欄位與使用者自己的完整網址原樣保留。
 */
import { resolveSitePathUrls } from '@open333crm/channel-plugins';
import { getApiPublicUrl } from '../storage/storage.service.js';

const SAMPLE_PREFIX = '/material-samples/';
/** 圖文訊息舊的示範底圖：靜態 jpeg 沒有 LINE 要的 baseUrl/{寬度}，換成 API 的示範底圖端點 */
const OLD_IMAGEMAP_SAMPLE = `${SAMPLE_PREFIX}promo-banner.jpeg`;

/** web 的公開網址。與 getApiPublicUrl() 一樣直接讀環境變數，預設值同 config/env.ts 的 WEB_BASE_URL */
function webBaseUrl(): string {
  return (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/**
 * @returns 站內路徑換成公開網址後的新 body；不是 LINE 或 FB 版型時原樣回傳
 */
export function resolveSampleImageUrls(
  contentType: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (contentType.startsWith('fb_')) return resolveSitePathUrls(body, webBaseUrl());
  if (!contentType.startsWith('line_')) return body;
  const base = webBaseUrl();
  const resolved = resolveSitePathUrls(body, base, (path) => path.startsWith(SAMPLE_PREFIX));
  if (
    contentType === 'line_imagemap' &&
    (resolved.baseImageUrl === `${base}${OLD_IMAGEMAP_SAMPLE}` || body.baseImageUrl === OLD_IMAGEMAP_SAMPLE)
  ) {
    resolved.baseImageUrl = `${getApiPublicUrl()}/line-imagemap/demo`;
  }
  return resolved;
}
