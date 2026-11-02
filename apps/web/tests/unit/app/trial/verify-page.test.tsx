// @vitest-environment jsdom
/**
 * 試用驗證頁（主規格 trial-application「驗證頁確認連結並設定密碼」，change trial-set-password-after-verify）。
 * axios 換成 mock：查詢連結回待驗證，送出密碼的結果由各測試指定。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { axiosMock, router } = vi.hoisted(() => ({
  axiosMock: { get: vi.fn(), post: vi.fn() },
  router: { push: vi.fn() },
}));
vi.mock('axios', () => ({ default: axiosMock }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=abc'),
  useRouter: () => router,
}));

import VerifyPage from '#src/app/trial/verify/page.js';

beforeEach(() => {
  axiosMock.get.mockReset();
  axiosMock.post.mockReset();
  axiosMock.get.mockResolvedValue({ data: { data: { email: 'owner@example.test', siteName: '甲', status: 'pending' } } });
});
afterEach(() => cleanup());

const fill = async (password: string, confirm = password, siteName?: string) => {
  const site = (await screen.findByDisplayValue('甲')) as HTMLInputElement;
  if (siteName !== undefined) fireEvent.change(site, { target: { value: siteName } });
  const [pw, pw2] = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  fireEvent.change(pw!, { target: { value: password } });
  fireEvent.change(pw2!, { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: '設定密碼並開通' }));
};

test('打開連結只查詢，顯示設定密碼的表單與申請的站台名稱', async () => {
  render(<VerifyPage />);

  assert.ok((await screen.findByDisplayValue('甲')) !== null);
  assert.ok(screen.queryByText('owner@example.test') !== null);
  assert.equal(axiosMock.post.mock.calls.length, 0, '打開頁面不應開通');
});

test('送出密碼與修改後的站台名稱，開通成功', async () => {
  axiosMock.post.mockResolvedValue({ data: { data: { siteName: '乙', alreadyProvisioned: false } } });
  render(<VerifyPage />);
  await fill('Password-OK-1', 'Password-OK-1', '乙');

  assert.ok((await screen.findByText('站台已開通')) !== null);
  const [, body] = axiosMock.post.mock.calls[0]!;
  assert.deepEqual(body, { token: 'abc', password: 'Password-OK-1', siteName: '乙' });
});

test('兩次密碼不一致：顯示錯誤，不送出', async () => {
  render(<VerifyPage />);
  await fill('Password-OK-1', 'Password-OK-2');

  assert.ok((await screen.findByRole('alert')).textContent?.includes('不一致'));
  assert.equal(axiosMock.post.mock.calls.length, 0);
});

test('伺服器拒絕：錯誤訊息顯示在表單上', async () => {
  axiosMock.post.mockRejectedValue({
    response: { data: { error: { code: 'VALIDATION_ERROR', message: '輸入內容有誤', details: { issues: [{ message: '密碼至少需要 8 個字元' }] } } } },
  });
  render(<VerifyPage />);
  await fill('Password-OK-1');

  assert.ok((await screen.findByRole('alert')).textContent?.includes('密碼至少需要 8 個字元'));
});

test('過期的連結：顯示失效畫面', async () => {
  axiosMock.get.mockRejectedValue({ response: { data: { error: { code: 'TRIAL_TOKEN_EXPIRED' } } } });
  render(<VerifyPage />);

  assert.ok((await screen.findByText('連結已失效或過期')) !== null);
});
