/**
 * 圖文訊息底圖的預覽網址。
 *
 * 上傳的底圖存的是 LINE 規定的 baseUrl（`/line-imagemap/{tenantId}/{imageId}`，不含寬度），
 * LINE 會自己加上 /{寬度} 抓圖；API 也只提供 baseUrl/{寬度}。後台的 <img> 直接用 baseUrl 會 404，
 * 所以預覽改用 1040（全寬尺寸）。示範用的靜態圖（/material-samples/...）原樣使用。
 */
export function imagemapPreviewSrc(url: string | undefined): string {
  if (!url) return '';
  if (url.includes('/line-imagemap/') && !/\/\d+$/.test(url)) return `${url}/1040`;
  return url;
}
