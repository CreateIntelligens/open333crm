/**
 * 核銷台 API 錯誤的分類，以及帳號錯誤對應的狀態卡與登入頁橫幅。
 * 文案依 mobile-prototype-spec 2.2「帳號錯誤一覽」與登入橫幅。
 */
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage } from '@/lib/api-error';

/** 任何核銷台 API 都可能回的帳號錯誤碼（spec「核銷台每次操作都檢查帳號狀態」） */
export const ACCOUNT_ERROR_CODES = [
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'STORE_ACCOUNT_NOT_FOUND',
  'PASSWORD_CHANGED',
  'SESSION_REVOKED',
  'STORE_ACCOUNT_DISABLED',
  'STORE_CLOSED',
  'TENANT_DISABLED',
  'NO_REDEEM_PERMISSION',
] as const;

export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

export type ClassifiedError =
  | { kind: 'account'; code: AccountErrorCode }
  | { kind: 'invalidCredentials' }
  | { kind: 'locked'; lockedUntil: number }
  | { kind: 'network' }
  | { kind: 'other'; message: string };

export function classifyError(err: unknown): ClassifiedError {
  const code = getApiErrorCode(err);
  if (code && (ACCOUNT_ERROR_CODES as readonly string[]).includes(code)) {
    return { kind: 'account', code: code as AccountErrorCode };
  }
  if (code === 'INVALID_CREDENTIALS') return { kind: 'invalidCredentials' };
  if (code === 'ACCOUNT_LOCKED') {
    const until = Date.parse(String(getApiErrorDetails(err)?.lockedUntil ?? ''));
    return { kind: 'locked', lockedUntil: Number.isNaN(until) ? Date.now() + 15 * 60_000 : until };
  }
  const e = err as { response?: { status?: number } } | null;
  // 沒有回應（斷線、逾時）或閘道錯誤：請求可能已到後端，也可能沒有，一律當成網路問題，讓使用者重試
  if (!e || typeof e !== 'object' || !e.response || (e.response.status ?? 0) >= 500) {
    return { kind: 'network' };
  }
  return { kind: 'other', message: getApiErrorMessage(err) };
}

/** 登入頁的橫幅 */
export type LoginBanner = 'error' | 'expired' | 'pwChanged' | 'kicked';

export const LOGIN_BANNER_TEXT: Record<LoginBanner, string> = {
  error: '帳號或密碼錯誤，請再試一次。忘記密碼請聯絡店長。',
  expired: '登入已過期，請重新登入。登入後會回到掃描畫面。',
  pwChanged: '密碼已更改，請輸入店長提供的最新密碼。',
  kicked: '此裝置已被登出，請重新登入。',
};

/** 帳號錯誤狀態卡 */
export interface AccountCard {
  title: string;
  description: string;
  button: string;
  /** 回到登入頁時帶的橫幅 */
  banner?: LoginBanner;
}

export function accountCard(code: AccountErrorCode): AccountCard {
  switch (code) {
    case 'STORE_ACCOUNT_NOT_FOUND':
      return { title: '找不到此門市帳號', description: '請聯絡店長或總部確認', button: '回到登入頁' };
    case 'STORE_ACCOUNT_DISABLED':
      return { title: '此門市帳號已停用', description: '請聯絡店長或總部確認', button: '回到登入頁' };
    case 'NO_REDEEM_PERMISSION':
      return { title: '沒有核銷權限', description: '請聯絡店長或總部開啟核銷權限', button: '回到登入頁' };
    case 'PASSWORD_CHANGED':
      return { title: '請重新登入', description: '密碼已更改，請向店長確認最新密碼', button: '重新登入', banner: 'pwChanged' };
    case 'SESSION_REVOKED':
      return { title: '請重新登入', description: '此裝置已被登出', button: '重新登入', banner: 'kicked' };
    case 'STORE_CLOSED':
      return { title: '此門市目前無法核銷', description: '門市已停止營運，請聯絡總部', button: '回到登入頁' };
    case 'TENANT_DISABLED':
      return { title: '核銷服務已停用', description: '商家的核銷服務已停用，請聯絡總部', button: '回到登入頁' };
    default:
      // UNAUTHORIZED、SESSION_EXPIRED：憑證失效或過期
      return { title: '請重新登入', description: '登入已過期，請重新登入', button: '重新登入', banner: 'expired' };
  }
}

/** 帳號錯誤在顧客面前發生時（查券、確認核銷）跟顧客說的話 */
export const ACCOUNT_SAY = '系統帳號有點狀況，您的券沒有被使用，請稍等一下。';

/** 一般錯誤的文案（非帳號錯誤、非業務結果） */
export const NETWORK_TEXT = '網路不穩，請確認網路後再試一次';
