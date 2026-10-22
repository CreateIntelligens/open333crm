/**
 * 門市與門市帳號的前端型別與共用規則（對應後端 /api/v1/stores）。
 * 規則來源：openspec add-coupon-system / store-redemption「管理者可管理門市與門市帳號」。
 */

export interface StoreAccount {
  id: string;
  storeId: string;
  username: string;
  canRedeem: boolean;
  isActive: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Store {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  accounts: StoreAccount[];
}

/** 帳號名稱：英文小寫、數字、連字號，3–32 字（與後端 Zod 一致）。 */
export const USERNAME_PATTERN = /^[a-z0-9-]{3,32}$/;
export const USERNAME_HINT = '只能使用英文小寫、數字與連字號，3–32 字';
export const PASSWORD_MIN_LENGTH = 8;

/** 回傳帳號名稱的錯誤說明；沒有錯誤時回傳 null。 */
export function validateUsername(value: string): string | null {
  if (!value) return '請輸入帳號名稱';
  if (!USERNAME_PATTERN.test(value)) return `帳號名稱${USERNAME_HINT}`;
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return '請輸入密碼';
  if (value.length < PASSWORD_MIN_LENGTH) return `密碼至少 ${PASSWORD_MIN_LENGTH} 字`;
  return null;
}

// 排除容易看錯的字元（0/O、1/l/I），店長要照著抄給店員
const PASSWORD_CHARSET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 以 Web Crypto 產生隨機密碼（不用 Math.random，避免可預測）。 */
export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_CHARSET[n % PASSWORD_CHARSET.length]).join('');
}

/** 鎖定中（lockedUntil 在未來）回傳解鎖時間，否則 null。 */
export function lockedUntilDate(account: StoreAccount, now = Date.now()): Date | null {
  if (!account.lockedUntil) return null;
  const until = new Date(account.lockedUntil);
  return until.getTime() > now ? until : null;
}

/**
 * GET /stores/:id/poster 的回應：url（QR 內容，帶門市 id）與 shortUrl（印給人手打，不帶 id）
 * 由後端以 WEB_BASE_URL 組成，qrDataUrl 為 PNG data URL。
 */
export interface StorePoster {
  storeName: string;
  url: string;
  shortUrl: string;
  qrDataUrl: string;
}
