/**
 * Facebook 連結完成後要導回的站內路徑（後端 /meta-connect/start 已驗證過 returnTo，這裡再擋一次，
 * 避免網址參數被改成外部網址形成開放重導）。
 *
 * 規則與後端 returnToSchema 相同：只接受 `/dashboard/` 開頭、不含 `//`、反斜線、空白或控制字元的路徑。
 * 瀏覽器解析網址時會刪掉 tab、換行（`/\t/evil.example` 會變成 `//evil.example`），所以空白與控制字元一律拒絕；
 * 最後再用 URL 解析確認仍在同一個來源，只回傳解析後的路徑。
 */
const PROBE_ORIGIN = 'https://return-to.invalid';

export function safeMetaConnectReturnTo(raw: string | null): string | null {
  if (!raw || raw.length > 500) return null;
  if (!raw.startsWith('/dashboard/') || raw.includes('//') || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN || !url.pathname.startsWith('/dashboard/')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
