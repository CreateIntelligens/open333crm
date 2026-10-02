/**
 * 登入失敗計數與帳號鎖定（change add-login-brute-force-protection，AUDIT SEC-05）。
 *
 * 依 email 計數而非 IP：IP 限流可被偽造的 X-Forwarded-For 或分散的來源繞過，帳號鎖定不受影響。
 * 不存在的 email 也照樣計數，回應與存在的帳號一致，不透露帳號是否存在。
 */
import crypto from 'node:crypto';
import IORedis from 'ioredis';
import { getConfig } from '../../config/env.js';

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Redis 的子集；測試以記憶體版取代 */
export interface LoginAttemptStore {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  /** 剩餘毫秒；沒有 TTL 回 -1、key 不存在回 -2 */
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  getdel(key: string): Promise<string | null>;
}

/** key 用 email 雜湊，Redis 裡不留明文 email */
function failureKey(email: string): string {
  const digest = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `login:fail:${digest}`;
}

/**
 * 每次嘗試一進來就原子 +1，超過上限即鎖定（成功登入時清除，所以等同計算失敗次數）。
 * 不能「先查是否鎖定、驗完密碼失敗才 +1」：同時送出的大量請求會在 +1 之前全部通過檢查，一次猜很多組。
 * 區間從第一次嘗試起算，期滿自動清除。
 */
export async function registerLoginAttempt(
  store: LoginAttemptStore,
  email: string,
): Promise<{ locked: false } | { locked: true; retryAfterMs: number }> {
  const key = failureKey(email);
  const attempts = await store.incr(key);
  let ttl = await store.pttl(key);
  // 沒有 TTL 就補上：兩個指令之間中斷也不會留下永不過期的計數把帳號永久鎖住
  if (ttl < 0) {
    await store.pexpire(key, LOGIN_FAILURE_WINDOW_MS);
    ttl = LOGIN_FAILURE_WINDOW_MS;
  }
  return attempts > LOGIN_MAX_FAILURES ? { locked: true, retryAfterMs: ttl } : { locked: false };
}

export async function clearLoginAttempts(store: LoginAttemptStore, email: string): Promise<void> {
  await store.getdel(failureKey(email));
}

let redisClient: IORedis | undefined;
export function getLoginAttemptStore(): LoginAttemptStore {
  redisClient ??= new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
  return redisClient as unknown as LoginAttemptStore;
}
