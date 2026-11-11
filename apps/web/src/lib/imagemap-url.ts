import { REALTIME_ORIGIN } from './constants';

/**
 * 圖文訊息的示範底圖（spec material-system「圖文訊息的示範底圖符合 LINE imagemap 規格」）。
 * 與上傳的底圖相同格式：API 的 /line-imagemap/demo/{寬度} 提供五種寬度，比例 1040:700。
 * REALTIME_ORIGIN 是 API 的來源（NEXT_PUBLIC_API_URL 去掉路徑），UAT 是 https，LINE 抓得到。
 */
export const IMAGEMAP_DEMO_BASE_URL = `${REALTIME_ORIGIN}/line-imagemap/demo`;

/**
 * 圖文訊息底圖的預覽網址。
 *
 * 底圖存的是 LINE 規定的 baseUrl（上傳的 `/line-imagemap/{tenantId}/{imageId}`、示範的
 * `/line-imagemap/demo`，都不含寬度），LINE 會自己加上 /{寬度} 抓圖；API 也只提供 baseUrl/{寬度}。
 * 後台的 <img> 直接用 baseUrl 會 404，所以預覽改用 1040（全寬尺寸）。
 */
export function imagemapPreviewSrc(url: string | undefined): string {
  if (!url) return '';
  // 示範底圖：…/line-imagemap/demo（結尾不帶寬度）
  if (/\/line-imagemap\/demo$/.test(url)) return `${url}/1040`;
  // 上傳產生的 baseUrl：…/line-imagemap/{tenantId}/{imageId}（剛好兩段、結尾不帶寬度）
  if (/\/line-imagemap\/(?!demo\/)[^/?#]+\/[^/?#]+$/.test(url)) return `${url}/1040`;
  return url;
}
