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

export async function isLoginLocked(store: LoginAttemptStore, email: string): Promise<boolean> {
  return Number((await store.get(failureKey(email))) ?? 0) >= LOGIN_MAX_FAILURES;
}

/** 計數 +1；區間從第一次失敗起算，期滿自動清除 */
export async function recordLoginFailure(store: LoginAttemptStore, email: string): Promise<void> {
  const key = failureKey(email);
  await store.incr(key);
  // 沒有 TTL 就補上：兩個指令之間中斷也不會留下永不過期的計數把帳號永久鎖住
  if ((await store.pttl(key)) < 0) await store.pexpire(key, LOGIN_FAILURE_WINDOW_MS);
}

export async function clearLoginFailures(store: LoginAttemptStore, email: string): Promise<void> {
  await store.getdel(failureKey(email));
}

let redisClient: IORedis | undefined;
export function getLoginAttemptStore(): LoginAttemptStore {
  redisClient ??= new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
  return redisClient as unknown as LoginAttemptStore;
}
