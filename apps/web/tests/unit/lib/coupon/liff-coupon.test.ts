/**
 * LIFF 入口頁的票券驗證流程（add-coupon-system design D20）。LIFF SDK 與 API 以替身取代。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { openCouponViaLiff, type LiffCouponDeps } from '#src/lib/coupon/liff-coupon.js';

const TOK = 'A'.repeat(43);

function deps(overrides: Partial<LiffCouponDeps> & { loggedIn?: boolean; idToken?: string | null; result?: unknown } = {}) {
  const login = vi.fn();
  const rememberDeviceToken = vi.fn();
  const post = vi.fn(async () => {
    if (overrides.result instanceof Error) throw overrides.result;
    return { data: { data: overrides.result ?? { status: 'verified', deviceToken: 'device-jwt' } } };
  });
  const d: LiffCouponDeps = {
    initLiff: async () => ({
      isLoggedIn: () => overrides.loggedIn ?? true,
      login,
      getIDToken: () => (overrides.idToken === undefined ? 'id-token' : overrides.idToken),
    }),
    post: post as unknown as LiffCouponDeps['post'],
    rememberDeviceToken,
    currentUrl: 'https://crm.example.com/liff/redirect?ct=tok&lid=L',
    ...overrides,
  };
  return { d, login, post, rememberDeviceToken };
}

test('驗證通過：送出 ID token、記住這台裝置後開啟一般票券網址', async () => {
  const { d, post, rememberDeviceToken } = deps();
  const r = await openCouponViaLiff(TOK, 'L', d);
  assert.deepEqual(r, { kind: 'navigate', to: `/coupon/open/${TOK}` });
  assert.deepEqual(post.mock.calls[0], ['/fan/coupons/liff-session', { token: TOK, idToken: 'id-token' }]);
  // 記住裝置（design D24）：一般票券網址呼叫 /session 時帶上，不必再驗證
  assert.deepEqual(rememberDeviceToken.mock.calls, [['device-jwt']]);
});

test('還沒登入 LINE：先登入，回到這一頁', async () => {
  const { d, login, post } = deps({ loggedIn: false });
  const r = await openCouponViaLiff(TOK, 'L', d);
  assert.deepEqual(r, { kind: 'login' });
  assert.deepEqual(login.mock.calls[0], [{ redirectUri: 'https://crm.example.com/liff/redirect?ct=tok&lid=L' }]);
  assert.equal(post.mock.calls.length, 0);
});

test('用其他 LINE 帳號開啟：顯示帳號不符', async () => {
  const { d } = deps({ result: { status: 'account_mismatch' } });
  const r = await openCouponViaLiff(TOK, 'L', d);
  assert.equal(r.kind, 'message');
  assert.match((r as { text: string }).text, /其他 LINE 帳號/);
});

for (const [name, opts] of [
  ['驗證失敗', { result: { status: 'verification_failed' } }],
  ['渠道沒有設定', { result: { status: 'not_configured' } }],
  ['拿不到 ID token（沒勾 openid）', { idToken: null }],
  ['API 錯誤或連結失效', { result: new Error('410') }],
] as const) {
  test(`${name}：改走一般票券網址（One ID 登記）`, async () => {
    const { d, rememberDeviceToken } = deps(opts as never);
    assert.deepEqual(await openCouponViaLiff(TOK, 'L', d), { kind: 'navigate', to: `/coupon/open/${TOK}` });
    assert.equal(rememberDeviceToken.mock.calls.length, 0, '沒有驗證通過不記住裝置');
  });
}

test('LIFF 初始化失敗：改走一般票券網址', async () => {
  const { d } = deps({ initLiff: async () => { throw new Error('init timeout'); } });
  assert.deepEqual(await openCouponViaLiff(TOK, 'L', d), { kind: 'navigate', to: `/coupon/open/${TOK}` });
});

test('token 格式不對時不送出請求', async () => {
  const { d, post } = deps();
  assert.deepEqual(await openCouponViaLiff('../../x', 'L', d), { kind: 'message', text: '連結無效' });
  assert.equal(post.mock.calls.length, 0);
});
