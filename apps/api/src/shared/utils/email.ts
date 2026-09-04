/**
 * Email 正規化：轉小寫 + 去頭尾空白。
 *
 * Postgres text 欄位大小寫敏感，若不正規化，`User@X.com` 與 `user@x.com`
 * 會被視為不同帳號——可能繞過唯一檢查建出重複帳號，或造成登入比對失敗。
 *
 * ⚠️ 目前僅平台帳號（PlatformUser）鏈路使用；租戶端 agent 登入沿用未正規化的
 * 既有行為（全系統一致），若要一併收斂需配合既有資料 migration，屬另一議題。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
