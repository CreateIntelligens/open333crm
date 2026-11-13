/**
 * Facebook 連結完成後要導回的站內路徑（後端 /meta-connect/start 已驗證過 returnTo，這裡再擋一次，
 * 避免網址參數被改成外部網址形成開放重導）。只接受以單一斜線開頭的站內路徑。
 */
export function safeMetaConnectReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}
