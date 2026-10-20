// @vitest-environment jsdom
/**
 * 核銷台帳號錯誤的狀態卡。
 * spec store-redemption「核銷台每次操作都檢查帳號狀態」：任何 API 回帳號錯誤碼，都切到對應的說明，
 * 按鈕回登入頁並帶對應橫幅；在確認核銷時發生要標示「本次未核銷」。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { apiError, coupon, lookupOk, me, today } from './fixtures.js';

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

const SAY = '「系統帳號有點狀況，您的券沒有被使用，請稍等一下。」';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStoreToken.mockReturnValue('tok');
  api.getStoreName.mockResolvedValue('大同3C・內湖門市');
  api.getMe.mockResolvedValue(me());
  api.getToday.mockResolvedValue(today());
});

async function openManual() {
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('tab', { name: '手動核銷' }));
}

async function lookup(code = 'AUTUMNR9XUX9RG') {
  fireEvent.change(screen.getByLabelText('輸入券上的序號'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
}

const OPEN_CASES: [string, string, string, string][] = [
  ['STORE_ACCOUNT_NOT_FOUND', '找不到此門市帳號', '請聯絡店長或總部確認', '回到登入頁'],
  ['STORE_ACCOUNT_DISABLED', '此門市帳號已停用', '請聯絡店長或總部確認', '回到登入頁'],
  ['STORE_CLOSED', '此門市目前無法核銷', '門市已停止營運，請聯絡總部', '回到登入頁'],
  ['PASSWORD_CHANGED', '請重新登入', '密碼已更改，請向店長確認最新密碼', '重新登入'],
  ['SESSION_REVOKED', '請重新登入', '此裝置已被登出', '重新登入'],
];

for (const [code, title, description, button] of OPEN_CASES) {
  test(`開啟核銷台時 ${code}：顯示「${title}」狀態卡`, async () => {
    api.getMe.mockRejectedValue(apiError(code === 'STORE_ACCOUNT_DISABLED' || code === 'STORE_CLOSED' ? 403 : 401, code));
    render(<StoreConsoleApp storeId={null} />);
    await screen.findByText(title);
    assert.ok(screen.getByText(description));
    assert.ok(screen.getByRole('button', { name: button }));
    // 開啟時顧客不在場：不顯示「可以這樣跟顧客說」，也不標示本次未核銷
    assert.ok(screen.queryByText('可以這樣跟顧客說') === null);
    assert.ok(screen.queryByText('本次未核銷') === null);
  });
}

test('開啟時帳號沒有核銷權限（/me canRedeem=false）：顯示沒有核銷權限', async () => {
  api.getMe.mockResolvedValue(me({ canRedeem: false }));
  render(<StoreConsoleApp storeId={null} />);
  await screen.findByText('沒有核銷權限');
  assert.ok(screen.getByText('請聯絡店長或總部開啟核銷權限'));
  assert.ok(screen.getByText('dt3c-neihu'));
});

test('密碼已更改：按重新登入回到登入頁並帶「密碼已更改」橫幅，清除門市憑證', async () => {
  api.getMe.mockRejectedValue(apiError(401, 'PASSWORD_CHANGED'));
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('button', { name: '重新登入' }));
  await screen.findByText('密碼已更改，請輸入店長提供的最新密碼。');
  assert.ok(api.clearStoreToken.mock.calls.length >= 1);
  assert.ok(screen.getByLabelText('門市帳號'));
});

test('被強制登出：回到登入頁帶「此裝置已被登出」橫幅', async () => {
  api.getMe.mockRejectedValue(apiError(401, 'SESSION_REVOKED'));
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('button', { name: '重新登入' }));
  await screen.findByText('此裝置已被登出，請重新登入。');
});

test('開啟時登入已過期：直接回登入頁並帶「登入已過期」橫幅', async () => {
  api.getMe.mockRejectedValue(apiError(401, 'SESSION_EXPIRED'));
  render(<StoreConsoleApp storeId={null} />);
  await screen.findByText('登入已過期，請重新登入。登入後會回到掃描畫面。');
});

test('查券時帳號被停用：顯示狀態卡與跟顧客說的話，但不標示本次未核銷', async () => {
  api.lookupCoupon.mockRejectedValue(apiError(403, 'STORE_ACCOUNT_DISABLED'));
  await openManual();
  await lookup();
  await screen.findByText('此門市帳號已停用');
  assert.ok(screen.getByText(SAY));
  assert.ok(screen.queryByText('本次未核銷') === null);
});

test('確認核銷時沒有核銷權限：標示「本次未核銷」，顯示券名、顧客、門市帳號與跟顧客說的話', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk(coupon()));
  api.redeemCoupon.mockRejectedValue(apiError(403, 'NO_REDEEM_PERMISSION'));
  await openManual();
  await lookup();
  fireEvent.click(await screen.findByRole('button', { name: '確認核銷' }));
  await screen.findByText('沒有核銷權限');
  assert.ok(screen.getByText('本次未核銷'));
  assert.ok(screen.getByText('秋季回饋 滿千折百'));
  assert.ok(screen.getByText('陳◯明'));
  assert.ok(screen.getByText('dt3c-neihu'));
  assert.ok(screen.getByText('可以這樣跟顧客說'));
  assert.ok(screen.getByText(SAY));
  fireEvent.click(screen.getByRole('button', { name: '回到登入頁' }));
  await screen.findByLabelText('門市帳號');
});

test('查看今日紀錄時被強制登出：顯示狀態卡，不顯示跟顧客說的話', async () => {
  render(<StoreConsoleApp storeId={null} />);
  await screen.findByRole('tab', { name: '掃描核銷' });
  api.getToday.mockRejectedValue(apiError(401, 'SESSION_REVOKED'));
  fireEvent.click(screen.getByRole('button', { name: /^紀錄/ }));
  await screen.findByText('此裝置已被登出');
  assert.ok(screen.queryByText('可以這樣跟顧客說') === null);
});
