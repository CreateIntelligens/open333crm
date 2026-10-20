// @vitest-environment jsdom
/**
 * 核銷台主畫面：掃描分頁（相機權限）與門市選單（登出）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { me, today } from './fixtures.js';

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

const getUserMedia = vi.fn();

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStoreToken.mockReturnValue('tok');
  api.getMe.mockResolvedValue(me());
  api.getToday.mockResolvedValue(today({ summary: { count: 5, discountTotal: 450, giftCount: 1, exchangeCount: 1 } }));
  getUserMedia.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('登入後預設在掃描分頁，以後鏡頭要求相機；頂部顯示門市名稱與今日筆數', async () => {
  getUserMedia.mockReturnValue(new Promise(() => {}));
  render(<StoreConsoleApp storeId={null} />);
  await screen.findByRole('tab', { name: '掃描核銷', selected: true });
  assert.ok(screen.getByRole('button', { name: /大同3C・內湖門市/ }));
  await screen.findByRole('button', { name: '紀錄 5' });
  assert.deepEqual(getUserMedia.mock.calls[0][0], { video: { facingMode: 'environment' }, audio: false });
  assert.ok(screen.getByText('請將顧客手機上的 QR Code 對準框內'));
});

test('相機權限被拒：顯示「無法使用相機」說明與三步驟，可改用手動核銷', async () => {
  getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  render(<StoreConsoleApp storeId={null} />);
  await screen.findByText('無法使用相機');
  assert.ok(screen.getByText('核銷台需要相機權限才能掃描 QR Code。開啟權限前，可以先用手動核銷輸入序號。'));
  assert.ok(screen.getByText('打開手機的「設定」'));
  assert.ok(screen.getByText('找到使用中的瀏覽器（Safari 或 Chrome）'));
  assert.ok(screen.getByText('將「相機」改為「允許」，再回到核銷台'));

  getUserMedia.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: '重新嘗試' }));
  assert.equal(getUserMedia.mock.calls.length, 2);
  await screen.findByText('請將顧客手機上的 QR Code 對準框內');

  getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  fireEvent.click(screen.getByRole('tab', { name: '手動核銷' }));
  fireEvent.click(screen.getByRole('tab', { name: '掃描核銷' }));
  fireEvent.click(await screen.findByRole('button', { name: '改用手動核銷' }));
  await screen.findByLabelText('輸入券上的序號');
});

test('點門市名稱開啟選單：顯示門市與帳號，登出回到登入頁並清除憑證', async () => {
  getUserMedia.mockReturnValue(new Promise(() => {}));
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('button', { name: /大同3C・內湖門市/ }));
  const dialog = await screen.findByRole('dialog');
  assert.ok(dialog.textContent?.includes('目前登入'));
  assert.ok(dialog.textContent?.includes('門市帳號 dt3c-neihu'));

  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  assert.ok(screen.queryByRole('dialog') === null);

  fireEvent.click(screen.getByRole('button', { name: /大同3C・內湖門市/ }));
  fireEvent.click(await screen.findByRole('button', { name: '登出' }));
  await screen.findByLabelText('門市帳號');
  assert.equal(api.clearStoreToken.mock.calls.length, 1);
});
