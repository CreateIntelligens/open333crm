import { API_BASE_URL } from '@/lib/constants';

/**
 * 給使用說明顯示的 API 主機（例如 `open333 login --host`、curl 範例）。
 * CLI 與範例都會自己接 `/api/v1/...`，所以主機是 API 網址去掉結尾的 `/api/v1`，保留部署的子路徑
 * （例如 `https://host/open333/api/v1` → `https://host/open333`）。
 * API 網址是相對路徑（API 與網頁同網域）時，前面接目前頁面的 origin。
 */
export function resolvePublicApiHost(apiBaseUrl: string, pageOrigin: string): string {
  const host = apiBaseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return /^https?:\/\//i.test(host) ? host : `${pageOrigin}${host}`;
}

export function getPublicApiHost(): string {
  const pageOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  return resolvePublicApiHost(API_BASE_URL, pageOrigin);
}
