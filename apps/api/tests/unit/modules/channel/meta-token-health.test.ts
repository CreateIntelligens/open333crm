/**
 * FB／IG 權杖健康判斷（change fix-meta-webhook-page-routing）：
 * 失效才通知、持續失效每 3 天提醒一次、無法判斷時不改狀態不通知。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { nextTokenHealth, probeChannelToken, type TokenHealth } from '#src/modules/channel/meta-token-health.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const fakeFetch = (status: number, body: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
};
const now = new Date('2026-10-01T00:00:00Z');
const hoursLater = (h: number) => new Date(now.getTime() + h * 3600_000);

test('從有效變成失效：通知並記下通知時間', () => {
  const prev: TokenHealth = { status: 'valid', checkedAt: now.toISOString() };
  const { health, notify } = nextTokenHealth(prev, { status: 'invalid', reason: 'expired' }, now);
  assert.equal(notify, true);
  assert.equal(health?.status, 'invalid');
  assert.equal(health?.notifiedAt, now.toISOString());
});

test('第一次檢查就失效（沒有前一次紀錄）：通知', () => {
  assert.equal(nextTokenHealth(undefined, { status: 'invalid' }, now).notify, true);
});

test('持續失效：3 天內不重複通知，滿 3 天再提醒一次', () => {
  const prev: TokenHealth = { status: 'invalid', checkedAt: now.toISOString(), notifiedAt: now.toISOString() };
  const within = nextTokenHealth(prev, { status: 'invalid' }, hoursLater(6));
  assert.equal(within.notify, false);
  assert.equal(within.health?.notifiedAt, now.toISOString(), '沿用上次通知時間');
  assert.equal(nextTokenHealth(prev, { status: 'invalid' }, hoursLater(72)).notify, true);
});

test('恢復有效：清除失效狀態、不通知', () => {
  const prev: TokenHealth = { status: 'invalid', checkedAt: now.toISOString(), notifiedAt: now.toISOString() };
  const { health, notify } = nextTokenHealth(prev, { status: 'valid' }, hoursLater(1));
  assert.equal(notify, false);
  assert.deepEqual(health, { status: 'valid', checkedAt: hoursLater(1).toISOString() });
});

test('無法判斷（網路錯誤等）：狀態不變、不通知', () => {
  const prev: TokenHealth = { status: 'valid', checkedAt: now.toISOString() };
  const { health, notify } = nextTokenHealth(prev, { status: 'unknown', reason: 'timeout' }, hoursLater(1));
  assert.equal(notify, false);
  assert.equal(health, prev);
});

test('probe：Meta 回 200 → 有效', async () => {
  fakeFetch(200, { id: '1' });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'valid');
});

test('probe：OAuthException 190 → 失效並帶原因', async () => {
  fakeFetch(400, { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } });
  const r = await probeChannelToken('FB', { pageAccessToken: 't' });
  assert.equal(r.status, 'invalid');
  assert.match(r.reason ?? '', /validating access token/);
});

test('probe：Meta 5xx、非權杖類錯誤、網路錯誤 → 無法判斷（不誤報）', async () => {
  fakeFetch(500, { error: { message: 'Service unavailable' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown');
  fakeFetch(400, { error: { type: 'GraphMethodException', code: 100, message: 'Unsupported get request' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown');
  globalThis.fetch = (async () => {
    throw new Error('ECONNRESET');
  }) as typeof fetch;
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown');
});

test('probe：沒有權杖 → 失效', async () => {
  assert.equal((await probeChannelToken('FB', {})).status, 'invalid');
});

test('probe：IG 渠道打 graph.instagram.com', async () => {
  let called = '';
  globalThis.fetch = (async (input: string | URL | Request) => {
    called = String(input);
    return new Response(JSON.stringify({ user_id: '1' }), { status: 200 });
  }) as typeof fetch;
  await probeChannelToken('THREADS', { pageAccessToken: 't' });
  assert.match(called, /graph\.instagram\.com/);
});

test('Meta 限流或暫時性錯誤：無法判斷，不可誤報失效', async () => {
  for (const code of [4, 17, 32, 613]) {
    fakeFetch(400, { error: { type: 'OAuthException', code, message: 'rate limit' } });
    assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown', `code ${code}`);
  }
  fakeFetch(400, { error: { type: 'OAuthException', code: 2, is_transient: true, message: 'temporary' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown');
});

test('權限被撤銷（code 10／200 系列）：失效', async () => {
  fakeFetch(403, { error: { type: 'OAuthException', code: 200, message: 'permission' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'invalid');
});

test('HTTP 429 或沒列出的 OAuthException：無法判斷，只有明確的權杖失效／權限撤銷才算失效', async () => {
  fakeFetch(429, { error: { type: 'OAuthException', code: 9999, message: 'slow down' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown');
  fakeFetch(400, { error: { type: 'OAuthException', code: 1, message: 'An unknown error occurred' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'unknown');
  fakeFetch(400, { error: { type: 'OAuthException', code: 190, message: 'expired' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'invalid');
  fakeFetch(403, { error: { type: 'OAuthException', code: 10, message: 'permission' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'invalid');
  fakeFetch(401, { error: { type: 'OAuthException', message: 'unauthorized' } });
  assert.equal((await probeChannelToken('FB', { pageAccessToken: 't' })).status, 'invalid');
});
