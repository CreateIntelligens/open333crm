/**
 * 向 LINE 驗證 ID token（add-coupon-system design D20）。fetch 以替身取代。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { checkLineIdToken, verifyLineIdToken } from '#src/modules/coupon/line-id-token.js';

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init: RequestInit }> = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

test('驗證通過：以 id_token 與 client_id 呼叫 LINE，回傳 sub', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const r = await verifyLineIdToken('tok', '1660000001', fakeFetch(200, { sub: 'U123', aud: '1660000001' }, calls));
  assert.deepEqual(r, { sub: 'U123' });
  assert.equal(calls[0].url, 'https://api.line.me/oauth2/v2.1/verify');
  assert.equal(calls[0].init.method, 'POST');
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get('id_token'), 'tok');
  assert.equal(body.get('client_id'), '1660000001');
});

test('LINE 回 400（過期、竄改、client_id 不符）', async () => {
  assert.equal(await verifyLineIdToken('tok', '1660000001', fakeFetch(400, { error: 'invalid_request' })), null);
});

test('回應的 aud 與 client_id 不同時不採用', async () => {
  assert.equal(await verifyLineIdToken('tok', '1660000001', fakeFetch(200, { sub: 'U123', aud: '9999999999' })), null);
});

test('連不上 LINE 時視為驗證失敗，不拋錯', async () => {
  const failing = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;
  assert.equal(await verifyLineIdToken('tok', '1660000001', failing), null);
});

// ── checkLineIdToken：測試 LIFF 設定時分辨「LINE 不接受」與「連不上 LINE」（change add-liff-config-test D4）──

test('checkLineIdToken：驗證通過回 ok 與 sub', async () => {
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', fakeFetch(200, { sub: 'U123', aud: '1660000001' })), { result: 'ok', sub: 'U123' });
});

test('checkLineIdToken：LINE 回 400 是 rejected', async () => {
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', fakeFetch(400, { error: 'invalid_request' })), { result: 'rejected' });
});

test('checkLineIdToken：aud 與 client_id 不同是 rejected', async () => {
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', fakeFetch(200, { sub: 'U123', aud: '9999999999' })), { result: 'rejected' });
});

test('checkLineIdToken：LINE 回 5xx 是 unreachable', async () => {
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', fakeFetch(503, {})), { result: 'unreachable' });
});

test('checkLineIdToken：LINE 限流（429）或逾時（408）是 unreachable，不是設定錯誤', async () => {
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', fakeFetch(429, {})), { result: 'unreachable' });
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', fakeFetch(408, {})), { result: 'unreachable' });
});

test('checkLineIdToken：連線失敗是 unreachable', async () => {
  const failing = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;
  assert.deepEqual(await checkLineIdToken('tok', '1660000001', failing), { result: 'unreachable' });
});
