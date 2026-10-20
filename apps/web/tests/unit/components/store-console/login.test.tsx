// @vitest-environment jsdom
/**
 * 核銷台登入（/redeem）。
 * spec store-redemption「門市帳號登入核銷台」（帳號或密碼錯誤、密碼錯誤 5 次後鎖定）與
 * 「門市海報連到核銷台登入頁」（登入頁依網址上的門市識別顯示門市名稱）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiError, me, networkError, today } from './fixtures.js';

const api = vi.hoisted(() => ({
  storeLogin: vi.fn(),
  getStoreName: vi.fn(),
  getMe: vi.fn(),
  lookupCoupon: vi.fn(),
  redeemCoupon: vi.fn(),
  getToday: vi.fn(),
  getStoreToken: vi.fn(),
  setStoreToken: vi.fn(),
  clearStoreToken: vi.fn(),
}));
vi.mock('#src/lib/store-console-api.js', () => api);
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { StoreConsoleApp } from '#src/components/store-console/StoreConsoleApp.js';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStoreToken.mockReturnValue(null);
  api.getStoreName.mockResolvedValue('大同3C・內湖門市');
  api.getMe.mockResolvedValue(me());
  api.getToday.mockResolvedValue(today());
});

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('門市帳號'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: password } });
}

test('登入頁依網址的門市識別顯示門市名稱，保持登入預設勾選', async () => {
  render(<StoreConsoleApp storeId="s1" />);
  await screen.findByText('大同3C・內湖門市');
  assert.equal(api.getStoreName.mock.calls[0][0], 's1');
  assert.ok(screen.getByText('請用門市帳號登入，同一門市的店員共用這組帳號。'));
  assert.ok(screen.getByText('忘記密碼請聯絡店長'));
  const account = screen.getByLabelText('門市帳號') as HTMLInputElement;
  assert.equal(account.getAttribute('autocomplete'), 'username');
  assert.equal(account.getAttribute('autocapitalize'), 'none');
  assert.equal((screen.getByLabelText('保持登入') as HTMLInputElement).checked, true);
});

test('登入成功：存入門市憑證（依保持登入）並進入掃描畫面', async () => {
  api.storeLogin.mockResolvedValue({ token: 'tok', storeName: '大同3C・內湖門市', username: 'dt3c-neihu', canRedeem: true });
  render(<StoreConsoleApp storeId={null} />);
  fill('dt3c-neihu', 'dt3c2026x');
  fireEvent.click(screen.getByLabelText('保持登入'));
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  await screen.findByRole('tab', { name: '掃描核銷' });
  assert.deepEqual(api.storeLogin.mock.calls[0][0], { username: 'dt3c-neihu', password: 'dt3c2026x', remember: false });
  assert.deepEqual(api.setStoreToken.mock.calls[0], ['tok', false]);
});

test('帳號或密碼錯誤：顯示錯誤橫幅並標紅欄位，開始修改就清除', async () => {
  api.storeLogin.mockRejectedValue(apiError(401, 'INVALID_CREDENTIALS', undefined, '帳號或密碼錯誤'));
  render(<StoreConsoleApp storeId={null} />);
  fill('dt3c-neihu', 'wrong');
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  await screen.findByText('帳號或密碼錯誤，請再試一次。忘記密碼請聯絡店長。');
  assert.equal(screen.getByLabelText('密碼').getAttribute('aria-invalid'), 'true');
  assert.equal(screen.getByLabelText('門市帳號').getAttribute('aria-invalid'), 'true');

  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'wrong2' } });
  assert.ok(screen.queryByText('帳號或密碼錯誤，請再試一次。忘記密碼請聯絡店長。') === null);
  assert.equal(screen.getByLabelText('密碼').getAttribute('aria-invalid'), 'false');
});

test('帳號或密碼空白時按登入不送出', async () => {
  render(<StoreConsoleApp storeId={null} />);
  fill('dt3c-neihu', '');
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  assert.equal(api.storeLogin.mock.calls.length, 0);
});

test('帳號鎖定：顯示倒數「請於 m:ss 後再試」並停用登入鈕，倒數會往下走', async () => {
  const lockedUntil = new Date(Date.now() + 65_000).toISOString();
  api.storeLogin.mockRejectedValue(apiError(423, 'ACCOUNT_LOCKED', { lockedUntil }));
  render(<StoreConsoleApp storeId={null} />);
  fill('dt3c-neihu', 'dt3c2026x');
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  const button = await screen.findByRole('button', { name: '請於 1:05 後再試' });
  assert.equal((button as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText(/密碼錯誤次數過多，帳號暫時鎖定/));
  await screen.findByRole('button', { name: '請於 1:04 後再試' }, { timeout: 2500 });
});

test('登入時網路錯誤：顯示說明，不可只寫在 console', async () => {
  api.storeLogin.mockRejectedValue(networkError());
  render(<StoreConsoleApp storeId={null} />);
  fill('dt3c-neihu', 'dt3c2026x');
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  await screen.findByText('網路不穩，請確認網路後再試一次');
});

test('登入時帳號已停用：顯示帳號狀態卡', async () => {
  api.storeLogin.mockRejectedValue(apiError(403, 'STORE_ACCOUNT_DISABLED'));
  render(<StoreConsoleApp storeId={null} />);
  fill('dt3c-neihu', 'dt3c2026x');
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  await screen.findByText('此門市帳號已停用');
  await waitFor(() => assert.ok(screen.getByRole('button', { name: '回到登入頁' })));
});
