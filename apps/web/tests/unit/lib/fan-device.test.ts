// @vitest-environment jsdom
/**
 * 裝置憑證（add-coupon-system design D24）：顧客在這台裝置驗證過後存在 localStorage，
 * 開啟票券連結時帶上，已歸戶的顧客就不必再驗證。同一個網域可能有多個租戶，最多存 5 筆，新的放前面。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { getFanDeviceTokens, rememberFanDeviceToken } from '#src/lib/fan-device.js';

/** 與後端相同結構的 JWT（簽章不檢查，前端只讀 payload 判斷是不是同一位顧客） */
function jwt(sub: string, tid: string, iat = 1, typ = 'fan-device'): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ typ, sub, tid, iat })}.sig`;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('沒有存過時回空陣列', () => {
  assert.deepEqual(getFanDeviceTokens(), []);
});

test('新的放前面，最多存 5 筆', () => {
  const tokens = Array.from({ length: 6 }, (_, i) => jwt(`c${i}`, `t${i}`));
  for (const t of tokens) rememberFanDeviceToken(t);
  assert.deepEqual(getFanDeviceTokens(), tokens.slice(1).reverse());
});

test('同一位顧客（同租戶、同聯絡人）換新時取代舊的', () => {
  const a1 = jwt('c1', 't1', 1);
  const b = jwt('c2', 't1');
  const a2 = jwt('c1', 't1', 2);
  rememberFanDeviceToken(a1);
  rememberFanDeviceToken(b);
  rememberFanDeviceToken(a2);
  assert.deepEqual(getFanDeviceTokens(), [a2, b]);
});

test('localStorage 內容壞掉時當作沒有存過', () => {
  window.localStorage.setItem('fanCouponDevices', '{not json');
  assert.deepEqual(getFanDeviceTokens(), []);
  const ok = jwt('c1', 't1');
  window.localStorage.setItem('fanCouponDevices', JSON.stringify([ok, 3, null]));
  assert.deepEqual(getFanDeviceTokens(), [ok]);
});

test('localStorage 被封鎖：讀寫都不丟錯', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
  rememberFanDeviceToken(jwt('c1', 't1'));
  assert.deepEqual(getFanDeviceTokens(), []);
});

// PR #359 bot 審查：localStorage 可能被同網域的其他程式寫入任意值，只送出結構正確的裝置憑證
test('只送出裝置憑證格式的值，其他字串略過', () => {
  const good = jwt('c1', 't1');
  window.localStorage.setItem('fanCouponDevices', JSON.stringify(['not-a-jwt', good, 'a.b.c', jwt('c2', 't2', 1, 'other')]));
  assert.deepEqual(getFanDeviceTokens(), [good]);
});
