/**
 * 識別值擁有權驗證碼（add-coupon-system design D15）：顧客送出 email 後先寄 6 位數驗證碼，
 * 輸入正確才寫入與歸戶。驗證碼綁定登記連結與送出時的值，只存雜湊。
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { bumpCounter, readCounter, type BindingStore } from './binding-code.js';
import {
  MAX_CODES_PER_LINK,
  REGISTRATION_TTL_MS,
  ownershipSendKey,
  readRegistration,
  type RegistrationKind,
} from './identifier-registration.js';

/** 驗證碼有效期 */
export const OWNERSHIP_CODE_TTL_MS = 10 * 60 * 1000;
/** 同一組驗證碼最多可輸入錯的次數 */
export const MAX_CODE_ATTEMPTS = 5;
export { MAX_CODES_PER_LINK };
/** 寄送中的鎖：同一個連結同時送出兩次時只寄一封，否則信中的驗證碼可能被另一次蓋掉 */
const SEND_LOCK_MS = 30_000;

export interface OwnershipCodeDeps {
  store: BindingStore;
  /** 寄出驗證碼；失敗時拋錯 */
  sendCode: (to: string, code: string) => Promise<void>;
}

interface PendingCode {
  value: string;
  codeHash: string;
}

/**
 * 一組驗證碼用到的 Redis key 與寄送期間。email 登記（以登記連結為單位）與票券夾確認身分
 * （以票券連結為單位，design D24）共用同一套寄送、比對與次數限制。
 */
export interface VerificationCodeKeys {
  code: string;
  attempt: string;
  send: string;
  sendLock: string;
  /** 雜湊的鹽：同一組數字在不同連結的雜湊不同 */
  salt: string;
  /** 寄送次數的計算期間 */
  sendWindowMs: number;
}

const registrationKeys = (kind: RegistrationKind, token: string): VerificationCodeKeys => ({
  code: `${kind.redisPrefix}:code:${token}`,
  attempt: `${kind.redisPrefix}:codeattempt:${token}`,
  send: ownershipSendKey(kind, token),
  sendLock: `${kind.redisPrefix}:codesendlock:${token}`,
  salt: token,
  sendWindowMs: REGISTRATION_TTL_MS,
});

function hashCode(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export type SendVerificationCodeResult =
  | { status: 'code_sent' }
  | { status: 'too_many_codes' }
  /** 同一個連結正在寄送另一封驗證信 */
  | { status: 'in_progress' }
  | { status: 'send_failed' };

/**
 * 產生 6 位數驗證碼並寄給 to，Redis 只存雜湊與 value（驗證通過時回傳）。
 * 重新寄出會取代前一組驗證碼並重設錯誤次數；寄信失敗不計入寄出次數。寄信不可放在資料庫交易內。
 */
export async function sendVerificationCode(
  store: BindingStore,
  keys: VerificationCodeKeys,
  to: string,
  value: string,
  sendCode: (to: string, code: string) => Promise<void>,
): Promise<SendVerificationCodeResult> {
  if ((await store.set(keys.sendLock, '1', 'PX', SEND_LOCK_MS, 'NX')) !== 'OK') return { status: 'in_progress' };
  try {
    if ((await readCounter(store, keys.send)) >= MAX_CODES_PER_LINK) return { status: 'too_many_codes' };

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await sendCode(to, code);
    } catch {
      return { status: 'send_failed' };
    }
    // 寄出後才換掉舊的驗證碼：寄信失敗時，前一封信的驗證碼仍可使用
    await store.getdel(keys.code);
    await store.getdel(keys.attempt);
    const pending: PendingCode = { value, codeHash: hashCode(keys.salt, code) };
    await store.set(keys.code, JSON.stringify(pending), 'PX', OWNERSHIP_CODE_TTL_MS, 'NX');
    await bumpCounter(store, keys.send, keys.sendWindowMs);
    return { status: 'code_sent' };
  } finally {
    await store.getdel(keys.sendLock);
  }
}

export type CheckVerificationCodeResult =
  /** claim 是通過時讀到的驗證碼紀錄，要「只能用一次」的呼叫端交給 consumeVerificationCode */
  | { status: 'ok'; value: string; claim: string }
  | { status: 'code_expired' }
  | { status: 'locked' }
  | { status: 'invalid_code'; remainingAttempts: number };

/**
 * 檢查驗證碼。先計入嘗試次數再以固定時間比對，並行猜碼也不會超過上限。
 * 通過時回傳寄碼時存下的 value；驗證碼要由呼叫端完成後以 clearVerificationCode 清除。
 */
export async function checkVerificationCode(
  store: BindingStore,
  keys: VerificationCodeKeys,
  rawCode: unknown,
): Promise<CheckVerificationCodeResult> {
  const raw = await store.get(keys.code);
  if (!raw) return { status: 'code_expired' };
  let pending: PendingCode;
  try {
    pending = JSON.parse(raw) as PendingCode;
  } catch {
    return { status: 'code_expired' };
  }
  const ttl = await store.pttl(keys.code);
  const attempts = await bumpCounter(store, keys.attempt, ttl > 0 ? ttl : OWNERSHIP_CODE_TTL_MS);
  if (attempts > MAX_CODE_ATTEMPTS) return { status: 'locked' };

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  const actual = Buffer.from(hashCode(keys.salt, code), 'hex');
  const expected = Buffer.from(pending.codeHash, 'hex');
  if (!/^\d{6}$/.test(code) || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 'invalid_code', remainingAttempts: MAX_CODE_ATTEMPTS - attempts };
  }
  return { status: 'ok', value: pending.value, claim: raw };
}

/**
 * 取走通過檢查的驗證碼（GETDEL 是原子操作）：同一組驗證碼的並行請求只有第一個取得，
 * 其他請求回 false（視為驗證碼已失效）。重寄換掉驗證碼後，舊的檢查結果也取不到。
 */
export async function consumeVerificationCode(
  store: BindingStore,
  keys: VerificationCodeKeys,
  claim: string,
): Promise<{ ok: true; ttlMs: number } | { ok: false }> {
  const ttlMs = await store.pttl(keys.code);
  return (await store.getdel(keys.code)) === claim ? { ok: true, ttlMs } : { ok: false };
}

/**
 * 取走驗證碼後的後續流程失敗（例如資料庫暫時無法連線）時放回，讓顧客用同一組驗證碼再試，
 * 不必重寄（寄送次數有上限）。NX：期間若已重寄新的驗證碼就不覆蓋。
 */
export async function restoreVerificationCode(store: BindingStore, keys: VerificationCodeKeys, claim: string, ttlMs: number): Promise<void> {
  if (ttlMs > 0) await store.set(keys.code, claim, 'PX', ttlMs, 'NX');
}

/** 清除驗證碼與錯誤次數；clearSends 為 true 時一併清除寄送次數 */
export async function clearVerificationCode(store: BindingStore, keys: VerificationCodeKeys, clearSends: boolean): Promise<void> {
  await store.getdel(keys.code);
  await store.getdel(keys.attempt);
  if (clearSends) await store.getdel(keys.send);
}

export type RequestCodeResult = { status: 'expired' } | { status: 'invalid_value' } | SendVerificationCodeResult;

/**
 * 寄出 email 登記的驗證碼。
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
  return sendVerificationCode(deps.store, registrationKeys(kind, token), value, value, deps.sendCode);
}

export type VerifyCodeResult = { status: 'expired' } | CheckVerificationCodeResult;

/**
 * 檢查 email 登記的驗證碼。通過時回傳送出驗證碼時的值；驗證碼要等登記完成後由 consumeOwnershipCode 清除。
 */
export async function verifyOwnershipCode(
  kind: RegistrationKind,
  store: BindingStore,
  token: string,
  rawCode: unknown,
): Promise<VerifyCodeResult> {
  if (!(await readRegistration(kind, store, token))) return { status: 'expired' };
  return checkVerificationCode(store, registrationKeys(kind, token), rawCode);
}

/** 登記完成後清除驗證碼與計數 */
export async function consumeOwnershipCode(kind: RegistrationKind, store: BindingStore, token: string): Promise<void> {
  await clearVerificationCode(store, registrationKeys(kind, token), true);
}
