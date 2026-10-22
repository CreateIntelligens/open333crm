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

/** 讀出憑證 payload 中的租戶與聯絡人（不驗證簽章，只用來判斷是不是同一位顧客） */
function identityOf(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { sub?: unknown; tid?: unknown };
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
    return list.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, MAX_FAN_DEVICES);
  } catch {
    return [];
  }
}

export function rememberFanDeviceToken(token: string): void {
  if (!token) return;
  try {
    const identity = identityOf(token);
    const rest = getFanDeviceTokens().filter((t) => t !== token && (identity === null || identityOf(t) !== identity));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([token, ...rest].slice(0, MAX_FAN_DEVICES)));
  } catch {
    // 私密瀏覽或被封鎖儲存：這台裝置下次開啟仍要驗證，不影響這次開啟
  }
}
