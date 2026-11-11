// @vitest-environment jsdom
/**
 * 今日核銷紀錄。spec store-redemption「今日核銷紀錄」：本門市今天的紀錄，附筆數、折抵總額、贈品數與兌換數。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { coupon, me, networkError, today } from './fixtures.js';

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

const ITEMS = [
  { ...coupon({ instanceId: 'r1', code: 'AUTUMN-R9XU-7QKD', customerName: '林◯君' }), redeemedAt: '2026-10-07T06:18:00.000Z' },
  {
    ...coupon({ instanceId: 'r2', code: 'CAFE-ICE2-QW4D', name: '加入好友禮 冰美式兌換券', couponType: 'EXCHANGE', exchangeItem: '冰美式中杯', exchangeValueCap: 90, minSpend: null, customerName: '劉◯宇' }),
    redeemedAt: '2026-10-07T03:07:00.000Z',
  },
  {
    ...coupon({ instanceId: 'r3', code: 'GIFT-FL72-8HZC', name: '空氣清淨機 加購禮', couponType: 'GIFT', giftName: '濾網', giftQty: 1, minSpend: null, customerName: '黃◯涵' }),
    redeemedAt: '2026-10-07T02:21:00.000Z',
  },
];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStoreToken.mockReturnValue('tok');
  api.getMe.mockResolvedValue(me());
});

async function openRecords() {
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('button', { name: /^紀錄/ }));
  await screen.findByRole('heading', { name: '今日核銷紀錄' });
}

test('頁首的紀錄數與統計：今日 N 筆、折抵總額、贈品與兌換數', async () => {
  api.getToday.mockResolvedValue(today({ items: ITEMS, summary: { count: 3, discountTotal: 100, giftCount: 1, exchangeCount: 1 } }));
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('button', { name: '紀錄 3' }));
  await screen.findByRole('heading', { name: '今日核銷紀錄' });
  assert.ok(screen.getByText('大同3C・內湖門市 · 2026/10/07'));
  assert.ok(screen.getByText('今日 3 筆'));
  assert.ok(screen.getByText('折抵 NT$100 · 贈品 1 · 兌換 1'));
});

test('數量為 0 的統計項目不顯示', async () => {
  api.getToday.mockResolvedValue(today({ items: [ITEMS[0]], summary: { count: 1, discountTotal: 100, giftCount: 0, exchangeCount: 0 } }));
  await openRecords();
  const stats = screen.getByRole('region', { name: '今日統計' });
  assert.ok(within(stats).getByText('折抵 NT$100'));
  assert.ok(within(stats).queryByText(/贈品/) === null);
});

test('列表顯示時間、券名、遮罩顧客與序號末 4 碼、優惠文字；點一列展開明細，一次只展開一列', async () => {
  api.getToday.mockResolvedValue(today({ items: ITEMS, summary: { count: 3, discountTotal: 100, giftCount: 1, exchangeCount: 1 } }));
  await openRecords();
  const rows = screen.getAllByRole('button', { expanded: false });
  const first = rows.find((r) => r.textContent?.includes('14:18'))!;
  assert.ok(first.textContent?.includes('秋季回饋 滿千折百'));
  assert.ok(first.textContent?.includes('林◯君 · …7QKD'));
  assert.ok(first.textContent?.includes('折抵 NT$100'));
  assert.ok(screen.getByText('兌換 冰美式中杯 ×1'));
  assert.ok(screen.getByText('贈送 濾網 ×1'));

  fireEvent.click(first);
  assert.equal(first.getAttribute('aria-expanded'), 'true');
  const detail = document.getElementById(first.getAttribute('aria-controls')!)!;
  assert.ok(within(detail).getByText('結帳折抵 NT$100（滿 NT$1,000）'));
  assert.ok(within(detail).getByText('AUTUMN-R9XU-7QKD'));
  assert.ok(within(detail).getByText('2026/10/07 14:18'));
  assert.ok(within(detail).getByText('大同3C・內湖門市'));

  const second = screen.getAllByRole('button').find((r) => r.textContent?.includes('11:07'))!;
  fireEvent.click(second);
  assert.equal(second.getAttribute('aria-expanded'), 'true');
  assert.equal(first.getAttribute('aria-expanded'), 'false');
});

test('空狀態', async () => {
  api.getToday.mockResolvedValue(today());
  await openRecords();
  assert.ok(screen.getByText('今日 0 筆'));
  assert.ok(screen.getByText('今天還沒有核銷紀錄'));
  assert.ok(screen.getByText('核銷成功後，會依時間顯示在這裡'));
});

test('返回回到原本的分頁', async () => {
  api.getToday.mockResolvedValue(today());
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('tab', { name: '手動核銷' }));
  fireEvent.click(screen.getByRole('button', { name: /^紀錄/ }));
  await screen.findByRole('heading', { name: '今日核銷紀錄' });
  fireEvent.click(screen.getByRole('button', { name: '返回核銷' }));
  await screen.findByRole('tab', { name: '手動核銷', selected: true });
});

test('載入失敗時顯示錯誤並可重新載入', async () => {
  api.getToday.mockResolvedValueOnce(today());
  api.getToday.mockRejectedValueOnce(networkError());
  await openRecords();
  const alert = await screen.findByRole('alert');
  assert.ok(alert.textContent?.includes('網路不穩'));
  api.getToday.mockResolvedValueOnce(today());
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  await screen.findByText('今天還沒有核銷紀錄');
});
