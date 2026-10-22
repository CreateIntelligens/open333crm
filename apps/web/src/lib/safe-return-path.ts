/**
 * 登記頁（/bind/*）送出後的返回路徑檢查。
 *
 * 票券連結要求驗證時，後端給的登記頁網址會帶 `next=/coupon/open/{token}`（design D12）。
 * next 來自網址，任何人都能竄改，所以只接受「票券入口的相對路徑」，避免成為開放式轉址：
 * - 必須以 `/coupon/open/` 開頭
 * - 不可含 `//`（protocol-relative，例如 `//evil.com`）、`:`（`https:`、`javascript:`）
 * - token 只允許 base64url 字元，順帶排除反斜線、空白與控制字元（瀏覽器會把 `\` 當成 `/`）
 *
 * @param next URL 上的 next 參數（已由 URLSearchParams 解碼）
 * @returns 可安全導向的相對路徑；不合格時回 null
 */
export function safeCouponReturnPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (next.includes('//') || next.includes(':')) return null;
  return /^\/coupon\/open\/[A-Za-z0-9_-]+$/.test(next) ? next : null;
}
