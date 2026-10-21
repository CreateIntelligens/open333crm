/**
 * 識別值擁有權驗證碼（add-coupon-system design D15）：顧客送出 email 後先寄 6 位數驗證碼，
 * 輸入正確才寫入與歸戶。驗證碼綁定登記連結與送出時的值，只存雜湊。
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { bumpCounter, readCounter, type BindingStore } from './binding-code.js';
import { REGISTRATION_TTL_MS, readRegistration, type RegistrationKind } from './identifier-registration.js';

/** 驗證碼有效期 */
export const OWNERSHIP_CODE_TTL_MS = 10 * 60 * 1000;
/** 同一組驗證碼最多可輸入錯的次數 */
export const MAX_CODE_ATTEMPTS = 5;
/** 同一個登記連結最多寄出的驗證碼數 */
export const MAX_CODES_PER_LINK = 3;

export interface OwnershipCodeDeps {
  store: BindingStore;
  /** 寄出驗證碼；失敗時拋錯 */
  sendCode: (to: string, code: string) => Promise<void>;
}

interface PendingCode {
  value: string;
  codeHash: string;
}

const codeKey = (kind: RegistrationKind, token: string) => `${kind.redisPrefix}:code:${token}`;
const attemptKey = (kind: RegistrationKind, token: string) => `${kind.redisPrefix}:codeattempt:${token}`;
const sendKey = (kind: RegistrationKind, token: string) => `${kind.redisPrefix}:codesend:${token}`;

/** 以登記連結的 token 作為鹽：同一組數字在不同連結的雜湊不同 */
function hashCode(token: string, code: string): string {
  return createHash('sha256').update(`${token}:${code}`).digest('hex');
}

export type RequestCodeResult =
  | { status: 'code_sent' }
  | { status: 'expired' }
  | { status: 'invalid_value' }
  | { status: 'too_many_codes' }
  | { status: 'send_failed' };

/**
 * 寄出驗證碼。重新寄出會取代前一組驗證碼並重設錯誤次數；寄信失敗不計入寄出次數。
 */
export async function requestOwnershipCode(
  kind: RegistrationKind,
  deps: OwnershipCodeDeps,
  token: string,
  rawValue: unknown,
): Promise<RequestCodeResult> {
  if (!(await readRegistration(kind, deps.store, token))) return { status: 'expired' };
  const value = kind.normalize(rawValue);
  if (!value) return { status: 'invalid_value' };
  if ((await readCounter(deps.store, sendKey(kind, token))) >= MAX_CODES_PER_LINK) return { status: 'too_many_codes' };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await deps.sendCode(value, code);
  } catch {
    return { status: 'send_failed' };
  }
  // 寄出後才換掉舊的驗證碼：寄信失敗時，前一封信的驗證碼仍可使用
  await deps.store.getdel(codeKey(kind, token));
  await deps.store.getdel(attemptKey(kind, token));
  const pending: PendingCode = { value, codeHash: hashCode(token, code) };
  await deps.store.set(codeKey(kind, token), JSON.stringify(pending), 'PX', OWNERSHIP_CODE_TTL_MS, 'NX');
  await bumpCounter(deps.store, sendKey(kind, token), REGISTRATION_TTL_MS);
  return { status: 'code_sent' };
}

export type VerifyCodeResult =
  | { status: 'ok'; value: string }
  | { status: 'expired' }
  | { status: 'code_expired' }
  | { status: 'locked' }
  | { status: 'invalid_code'; remainingAttempts: number };

/**
 * 檢查驗證碼。先計入嘗試次數再比對，並行猜碼也不會超過上限。
 * 通過時回傳送出驗證碼時的值；驗證碼要等登記完成後由 consumeOwnershipCode 清除。
 */
export async function verifyOwnershipCode(
  kind: RegistrationKind,
  store: BindingStore,
  token: string,
  rawCode: unknown,
): Promise<VerifyCodeResult> {
  if (!(await readRegistration(kind, store, token))) return { status: 'expired' };
  const raw = await store.get(codeKey(kind, token));
  if (!raw) return { status: 'code_expired' };
  let pending: PendingCode;
  try {
    pending = JSON.parse(raw) as PendingCode;
  } catch {
    return { status: 'code_expired' };
  }
  const ttl = await store.pttl(codeKey(kind, token));
  const attempts = await bumpCounter(store, attemptKey(kind, token), ttl > 0 ? ttl : OWNERSHIP_CODE_TTL_MS);
  if (attempts > MAX_CODE_ATTEMPTS) return { status: 'locked' };

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  const actual = Buffer.from(hashCode(token, code), 'hex');
  const expected = Buffer.from(pending.codeHash, 'hex');
  if (!/^\d{6}$/.test(code) || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 'invalid_code', remainingAttempts: MAX_CODE_ATTEMPTS - attempts };
  }
  return { status: 'ok', value: pending.value };
}

/** 登記完成後清除驗證碼與計數 */
export async function consumeOwnershipCode(kind: RegistrationKind, store: BindingStore, token: string): Promise<void> {
  await store.getdel(codeKey(kind, token));
  await store.getdel(attemptKey(kind, token));
  await store.getdel(sendKey(kind, token));
}
