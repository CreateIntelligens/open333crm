// @vitest-environment jsdom
/**
 * 顧客券夾（/coupon/wallet）。
 * spec coupon-redemption「顧客可於券夾查看持有的券」（券夾依狀態分流、沒有任何券）與
 * 「顧客須完成歸戶驗證才能開啟票券夾」（沒有顧客憑證時不顯示券夾）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  return {
    router: { push, replace: vi.fn(), back: vi.fn() },
    push,
    useWallet: vi.fn(),
    getFanToken: vi.fn(),
    mutate: vi.fn(),
  };
});

vi.mock('#src/hooks/useFanCoupons.js', () => ({ useWallet: mocks.useWallet }));
vi.mock('#src/lib/fan-api.js', () => ({ default: {}, getFanToken: mocks.getFanToken, setFanToken: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

import { WalletView } from '#src/components/fan-coupon/wallet/WalletView.js';
import type { FanCoupon, WalletStatus, WalletTab } from '#src/hooks/useFanCoupons.js';

function item(id: string, name: string, walletStatus: WalletStatus, walletTab: WalletTab): FanCoupon {
  return {
    id,
    code: 'X',
    codeHidden: false,
    availableAt: null,
    status: 'CLAIMED',
    walletStatus,
    walletTab,
    daysLeft: walletStatus === 'EXPIRING' ? 3 : null,
    expiresAt: '2026-10-31T00:00:00.000Z',
    claimedAt: null,
    openedAt: null,
    redeemedAt: walletStatus === 'USED' ? '2026-10-12T00:00:00.000Z' : null,
    coupon: {
      name,
      description: null,
      terms: null,
      imageUrl: null,
      couponType: 'DISCOUNT_AMOUNT',
      discountAmount: 100,
      discountPercent: null,
      minSpend: null,
      percentCap: null,
      giftName: null,
      giftQty: null,
      exchangeItem: null,
      exchangeValueCap: null,
      validityMode: 'FIXED',
      startAt: null,
      endAt: null,
      redeemMode: 'STAFF_CODE',
      afterOpenMinutes: null,
      staffCodeLength: 6,
    },
  };
}

const COUPONS = [
  item('a1', '秋季新品 85 折', 'EXPIRING', 'available'),
  item('a2', '秋季回饋 滿千折百', 'AVAILABLE', 'available'),
  item('u1', '首購優惠金 NT$100', 'USED', 'used'),
  item('x1', '夏日快閃折抵 NT$100', 'EXPIRED', 'invalid'),
];

function wallet(over: Partial<{ coupons: FanCoupon[]; counts: Record<WalletTab, number>; error: unknown; isLoading: boolean }> = {}) {
  mocks.useWallet.mockReturnValue({
    coupons: COUPONS,
    counts: { available: 2, used: 1, invalid: 1 },
    error: undefined,
    isLoading: false,
    mutate: mocks.mutate,
    ...over,
  });
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.useWallet.mockReset();
  mocks.mutate.mockReset();
  mocks.getFanToken.mockReset();
  mocks.getFanToken.mockReturnValue('fan-jwt');
});

test('券夾依狀態分流：分頁帶數量，預設可使用', () => {
  wallet();
  render(<WalletView />);
  const tabs = screen.getAllByRole('tab');
  assert.deepEqual(
    tabs.map((t) => t.textContent),
    ['可使用2', '已使用1', '已失效1'],
  );
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  const panel = screen.getByRole('tabpanel');
  assert.ok(within(panel).getByText('秋季新品 85 折'));
  assert.ok(within(panel).getByText('秋季回饋 滿千折百'));
  assert.ok(within(panel).queryByText('首購優惠金 NT$100') === null);
});

test('切換到已使用與已失效分頁', () => {
  wallet();
  render(<WalletView />);
  fireEvent.click(screen.getByRole('tab', { name: /已使用/ }));
  assert.ok(within(screen.getByRole('tabpanel')).getByText('首購優惠金 NT$100'));
  assert.ok(screen.queryByText('秋季回饋 滿千折百') === null);
  fireEvent.click(screen.getByRole('tab', { name: /已失效/ }));
  assert.ok(within(screen.getByRole('tabpanel')).getByText('夏日快閃折抵 NT$100'));
});

test('點選券卡開啟券詳情', () => {
  wallet();
  render(<WalletView />);
  fireEvent.click(screen.getByText('秋季回饋 滿千折百'));
  assert.deepEqual(mocks.push.mock.calls.at(-1), ['/coupon/wallet/a2']);
});

test('沒有任何券：可使用分頁顯示空狀態', () => {
  wallet({ coupons: [], counts: { available: 0, used: 0, invalid: 0 } });
  render(<WalletView />);
  assert.ok(screen.getByText('目前沒有可使用的優惠券'));
  assert.ok(screen.getByText('收到的優惠券會出現在這裡'));
});

test('已使用、已失效分頁也有空狀態', () => {
  wallet({ coupons: [COUPONS[1]], counts: { available: 1, used: 0, invalid: 0 } });
  render(<WalletView />);
  fireEvent.click(screen.getByRole('tab', { name: /已使用/ }));
  assert.ok(screen.getByText('還沒有使用過的優惠券'));
  fireEvent.click(screen.getByRole('tab', { name: /已失效/ }));
  assert.ok(screen.getByText('沒有已失效的優惠券'));
});

test('沒有顧客憑證：請顧客回到對話，不讀取券夾', () => {
  mocks.getFanToken.mockReturnValue(null);
  wallet();
  render(<WalletView />);
  assert.ok(screen.getByText('請回到對話，點選優惠券連結開啟'));
  assert.ok(screen.queryByRole('tab') === null);
  assert.equal(mocks.useWallet.mock.calls.every((c) => c[0] === false), true);
});

test('顧客憑證失效（401）：請顧客回到對話', () => {
  wallet({ coupons: [], error: Object.assign(new Error('401'), { response: { status: 401 } }) });
  render(<WalletView />);
  assert.ok(screen.getByText('請回到對話，點選優惠券連結開啟'));
});

test('其他錯誤：顯示錯誤並可重試', () => {
  wallet({ coupons: [], error: new Error('Network Error') });
  render(<WalletView />);
  assert.ok(screen.getByText('無法載入優惠券'));
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  assert.equal(mocks.mutate.mock.calls.length, 1);
});

test('載入中：顯示骨架，不顯示空狀態', () => {
  wallet({ coupons: [], isLoading: true });
  render(<WalletView />);
  assert.ok(screen.getByLabelText('載入中'));
  assert.ok(screen.queryByText('目前沒有可使用的優惠券') === null);
});
