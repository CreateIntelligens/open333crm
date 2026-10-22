/**
 * 顧客裝置憑證（add-coupon-system design D24）。
 *
 * 顧客在這台裝置（瀏覽器）完成驗證後，後端發一個長效的裝置憑證。開啟票券連結時帶上，
 * 已歸戶的顧客就不必再驗證；連結被轉傳到別的裝置時，要以原 email 的驗證碼確認身分。
 *
 * 存在 localStorage（關閉分頁後仍在）。同一個網域可能有多個租戶，所以存成陣列：最多 5 筆，新的放前面，
 * 同一位顧客（同租戶、同聯絡人）換新時取代舊的。私密瀏覽或被封鎖儲存時讀寫都不丟錯，只是每次都要驗證。
 */

const STORAGE_KEY = 'fanCouponDevices';
/** 與後端 /fan/coupons/session 可接受的筆數相同 */
export const MAX_FAN_DEVICES = 5;

/**
 * 讀出裝置憑證 payload 中的租戶與聯絡人（不驗證簽章，只用來判斷是不是同一位顧客、過濾掉不是裝置憑證的值）。
 * 不是三段式 JWT、或 typ 不是 fan-device 時回 null。簽章仍由後端驗證。
 */
function identityOf(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { typ?: unknown; sub?: unknown; tid?: unknown };
    if (payload.typ !== 'fan-device') return null;
    return typeof payload.sub === 'string' && typeof payload.tid === 'string' ? `${payload.tid}:${payload.sub}` : null;
  } catch {
    return null;
  }
}

export function getFanDeviceTokens(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    // localStorage 可能被同網域的其他程式寫入任意值：只送出結構正確的裝置憑證
    return list.filter((t): t is string => typeof t === 'string' && identityOf(t) !== null).slice(0, MAX_FAN_DEVICES);
  } catch {
    return [];
  }
}

export function rememberFanDeviceToken(token: string): void {
  // 只在瀏覽器執行；伺服器端轉譯或測試環境沒有 localStorage
  if (!token || typeof window === 'undefined') return;
  try {
    const identity = identityOf(token);
    // 後端回的不是裝置憑證：不存，也不動已存的憑證
    if (identity === null) return;
    const rest = getFanDeviceTokens().filter((t) => t !== token && identityOf(t) !== identity);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([token, ...rest].slice(0, MAX_FAN_DEVICES)));
  } catch {
    // 私密瀏覽或被封鎖儲存：這台裝置下次開啟仍要驗證，不影響這次開啟
  }
}
