/**
 * 店員驗證碼核銷時段（Redis）：5 分鐘內、最多錯 5 次；同一位顧客 × 同一張券 24 小時最多錯 10 次。
 * 只操作 Redis、不碰資料庫，由 coupon-wallet.flow.ts 在交易外呼叫。
 */
import type { BindingStore } from '../identity-binding/binding-code.js';

/** 按下「立即使用」後的核銷時段長度 */
export const REDEEM_SESSION_MS = 5 * 60 * 1000;
/** 一個時段內最多可輸入錯誤的次數 */
export const MAX_CODE_ATTEMPTS = 5;
/**
 * 同一張券 24 小時內最多可輸入錯誤的次數（跨時段累計）。驗證碼是整張券共用的，
 * 只限制單一時段的話，重新開始就能無限試下去，試出來後所有持有者都能自行核銷。
 */
export const MAX_DAILY_CODE_ATTEMPTS = 10;
export const DAILY_ATTEMPTS_MS = 24 * 60 * 60 * 1000;
/**
 * Redis 保存時段的時間比時段本身長：時段結束後短時間內送出驗證碼，
 * 才能回報「核銷時間已結束」而不是「須先開始使用」。
 */
export const SESSION_KEEP_MS = REDEEM_SESSION_MS * 2;

const sessionKey = (instanceId: string) => `coupon:redeem-session:${instanceId}`;
export const attemptsKey = (instanceId: string) => `coupon:redeem-session:${instanceId}:attempts`;

/** 24 小時內已用掉的驗證碼嘗試次數 */
export async function dailyAttempts(store: BindingStore, key: string): Promise<number> {
  return Number((await store.get(key)) ?? 0);
}

/** 先佔一次嘗試再比對：同時送出多個請求也都會被計入 */
export async function takeAttempt(store: BindingStore, key: string, ttlMs: number): Promise<number> {
  const n = await store.incr(key);
  if (n === 1) await store.pexpire(key, ttlMs);
  return n;
}

export async function readSession(store: BindingStore, instanceId: string): Promise<{ expiresAt: number } | null> {
  const raw = await store.get(sessionKey(instanceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { expiresAt: number };
    return Number.isFinite(parsed.expiresAt) ? parsed : null;
  } catch {
    return null;
  }
}

/** 開新時段：清掉舊時段與錯誤次數 */
export async function openSession(store: BindingStore, instanceId: string, now: number): Promise<number> {
  await closeSession(store, instanceId);
  const expiresAt = now + REDEEM_SESSION_MS;
  await store.set(sessionKey(instanceId), JSON.stringify({ expiresAt }), 'PX', SESSION_KEEP_MS, 'NX');
  return expiresAt;
}

export async function closeSession(store: BindingStore, instanceId: string): Promise<void> {
  await store.getdel(sessionKey(instanceId));
  await store.getdel(attemptsKey(instanceId));
}
