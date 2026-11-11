// @vitest-environment jsdom
/**
 * LIFF 入口頁的測試流程（change add-liff-config-test，spec channel-management「LIFF 入口頁的測試流程」）。
 * LIFF SDK 與 API 以替身取代。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { LIFF_TEST_EXPIRED_TEXT, runLiffTest, type LiffTestPageDeps } from '#src/lib/liff-test.js';
import { resolveLiffParams } from '#src/lib/liff.js';

const TEST_ID = 'T'.repeat(43);

function deps(o: { loggedIn?: boolean; idToken?: string | null; initFails?: boolean; reply?: unknown } = {}) {
  const login = vi.fn();
  const post = vi.fn(async () => {
    if (o.reply instanceof Error) throw o.reply;
    return { data: { data: o.reply ?? { status: 'verified', message: '設定正確' } } };
  });
  const d: LiffTestPageDeps = {
    initLiff: async () => {
      if (o.initFails) throw new Error('liff.init timed out after 8000ms');
      return { isLoggedIn: () => o.loggedIn ?? true, login, getIDToken: () => (o.idToken === undefined ? 'id-token' : o.idToken) };
    },
    post: post as unknown as LiffTestPageDeps['post'],
    currentUrl: 'https://crm.example.com/liff/redirect?lt=x&lid=L',
  };
  return { d, login, post };
}

test('取得 ID token 後回報：送出 testId 與 ID token，顯示回傳的說明', async () => {
  const { d, post } = deps();
  assert.deepEqual(await runLiffTest(TEST_ID, 'L', d), { kind: 'message', text: '設定正確', ok: true });
  assert.deepEqual(post.mock.calls[0], ['/fan/liff-test', { testId: TEST_ID, idToken: 'id-token' }]);
});

test('還沒登入 LINE：先登入，回到這一頁', async () => {
  const { d, login, post } = deps({ loggedIn: false });
  assert.deepEqual(await runLiffTest(TEST_ID, 'L', d), { kind: 'login' });
  assert.deepEqual(login.mock.calls[0], [{ redirectUri: d.currentUrl }]);
  assert.equal(post.mock.calls.length, 0);
});

test('沒有 ID token：回報 no_id_token，顯示回傳的說明', async () => {
  const { d, post } = deps({ idToken: null, reply: { status: 'no_id_token', message: '請勾選 openid' } });
  assert.deepEqual(await runLiffTest(TEST_ID, 'L', d), { kind: 'message', text: '請勾選 openid', ok: false });
  assert.deepEqual(post.mock.calls[0], ['/fan/liff-test', { testId: TEST_ID, failure: 'no_id_token' }]);
});

test('LIFF 啟動失敗：回報 init_failed，顯示回傳的說明', async () => {
  const { d, post } = deps({ initFails: true, reply: { status: 'init_failed', message: 'LIFF 無法啟動' } });
  assert.deepEqual(await runLiffTest(TEST_ID, 'L', d), { kind: 'message', text: 'LIFF 無法啟動', ok: false });
  assert.deepEqual(post.mock.calls[0], ['/fan/liff-test', { testId: TEST_ID, failure: 'init_failed' }]);
});

test('LIFF 啟動後的 SDK 呼叫拋錯：回報 init_failed，不讓後台停在等待結果', async () => {
  for (const broken of ['isLoggedIn', 'getIDToken'] as const) {
    const { d, post } = deps({ reply: { status: 'init_failed', message: 'LIFF 無法啟動' } });
    const init = d.initLiff;
    d.initLiff = async (id) => ({ ...(await init(id)), [broken]: () => { throw new Error(`${broken} failed`); } });
    assert.deepEqual(await runLiffTest(TEST_ID, 'L', d), { kind: 'message', text: 'LIFF 無法啟動', ok: false }, broken);
    assert.deepEqual(post.mock.calls[0], ['/fan/liff-test', { testId: TEST_ID, failure: 'init_failed' }], broken);
  }
});

test('測試連結過期：顯示請回後台重新產生', async () => {
  const expired = Object.assign(new Error('Request failed with status code 410'), { response: { status: 410 } });
  const { d } = deps({ reply: expired });
  assert.deepEqual(await runLiffTest(TEST_ID, 'L', d), { kind: 'message', text: LIFF_TEST_EXPIRED_TEXT, ok: false });
  assert.match(LIFF_TEST_EXPIRED_TEXT, /測試連結已過期，請回後台重新產生/);
});

test('送不出結果：說明沒有送出，不顯示成功', async () => {
  const { d } = deps({ reply: new Error('Network Error') });
  const r = await runLiffTest(TEST_ID, 'L', d);
  assert.equal(r.kind, 'message');
  assert.equal(r.kind === 'message' && r.ok, false);
});

afterEach(() => {
  sessionStorage.clear();
});

test('resolveLiffParams：網址的 lt 存起來，LIFF 登入來回後網址沒有參數時還原', () => {
  assert.deepEqual(resolveLiffParams(`?lt=${TEST_ID}&lid=L`).lt, TEST_ID);
  // LINE webview 重新載入 /liff/redirect 時可能沒有任何參數
  const restored = resolveLiffParams('');
  assert.equal(restored.lt, TEST_ID);
  assert.equal(restored.lid, 'L');
});

test('resolveLiffParams：lt 放在 liff.state 裡也讀得到', () => {
  const state = encodeURIComponent(`?lt=${TEST_ID}&lid=L`);
  assert.equal(resolveLiffParams(`?liff.state=${state}`).lt, TEST_ID);
});

test('resolveLiffParams：開短連結時清掉上一次測試的 lt', () => {
  resolveLiffParams(`?lt=${TEST_ID}&lid=L`);
  assert.equal(resolveLiffParams('?s=abc&lid=L').lt, null);
});
