// @vitest-environment jsdom
/**
 * 顧客券詳情與三種核銷（openspec add-coupon-system / coupon-redemption；Figma 顧客端 C4～C8.3）。
 * 替換資料 hook、顧客憑證與 next/navigation，只測畫面行為。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => {
  const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
  return {
    router,
    mutate: vi.fn(),
    coupon: null as unknown,
    error: undefined as unknown,
    refreshMs: [] as number[],
    token: 'fan-token' as string | null,
    start: vi.fn(),
    redeemCode: vi.fn(),
    redeemSelf: vi.fn(),
    qr: vi.fn(),
    open: vi.fn(),
  };
});

vi.mock('#src/hooks/useFanCoupons.js', () => ({
  useFanCoupon: (_id: string | null, refreshMs = 0) => {
    h.refreshMs.push(refreshMs);
    return { coupon: h.coupon, error: h.error, isLoading: false, mutate: h.mutate };
  },
  startStaffCodeSession: (...a: unknown[]) => h.start(...a),
  redeemWithStaffCode: (...a: unknown[]) => h.redeemCode(...a),
  redeemSelf: (...a: unknown[]) => h.redeemSelf(...a),
  getCouponQrCode: (...a: unknown[]) => h.qr(...a),
  openCoupon: (...a: unknown[]) => h.open(...a),
}));
vi.mock('#src/lib/fan-api.js', () => ({ default: {}, getFanToken: () => h.token, setFanToken: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router }));

import { CouponRedeemFlow } from '#src/components/fan-coupon/detail/CouponRedeemFlow.js';

const ID = 'i1';

function fanCoupon(overrides: Record<string, unknown> = {}, couponOverrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    code: 'SVC-K7P2-4M9X',
    codeHidden: false,
    availableAt: null,
    status: 'CLAIMED',
    walletStatus: 'AVAILABLE',
    walletTab: 'available',
    daysLeft: null,
    expiresAt: '2026-10-31T15:59:59.000Z',
    claimedAt: '2026-10-06T07:42:00.000Z',
    openedAt: null,
    redeemedAt: null,
    ...overrides,
    coupon: {
      name: '客服補償金 - 訂單延遲致歉',
      description: null,
      terms: '<ul><li>單筆訂單限用一張</li></ul>',
      imageUrl: null,
      couponType: 'DISCOUNT_AMOUNT',
      discountAmount: 500,
      discountPercent: null,
      minSpend: null,
      percentCap: null,
      giftName: null,
      giftQty: null,
      exchangeItem: null,
      exchangeValueCap: null,
      validityMode: 'FIXED',
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-10-31T15:59:59.000Z',
      redeemMode: 'STAFF_CODE',
      afterOpenMinutes: null,
      staffCodeLength: 6,
      ...couponOverrides,
    },
  };
}

/** 模擬 axios 的錯誤回應 */
function apiError(code: string, details: Record<string, unknown> = {}, status = 409) {
  return Object.assign(new Error(code), {
    response: { status, data: { success: false, error: { code, message: `錯誤 ${code}`, details } } },
  });
}

const flush = () => act(async () => {});
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const codeInput = () => screen.getByLabelText(/驗證碼/, { selector: 'input' }) as HTMLInputElement;

beforeEach(() => {
  h.coupon = fanCoupon();
  h.error = undefined;
  h.token = 'fan-token';
  h.refreshMs = [];
  for (const fn of [h.mutate, h.start, h.redeemCode, h.redeemSelf, h.qr, h.open, h.router.push, h.router.replace]) fn.mockReset();
  h.mutate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('券詳情：主按鈕依核銷方式與狀態', () => {
  test('店員驗證碼券顯示「立即使用」與券號、使用說明', () => {
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(button('立即使用'));
    assert.ok(screen.getByText('SVC-K7P2-4M9X'));
    assert.ok(screen.getByText('結帳時按「立即使用」，再把手機交給店員輸入驗證碼'));
    assert.ok(screen.getByRole('heading', { name: '優惠券詳情' }));
  });

  test('一行一條的使用條款顯示為清單', () => {
    h.coupon = fanCoupon({}, { terms: '單筆訂單限用一張\n僅限本人使用\n核銷需由門市人員操作' });
    render(<CouponRedeemFlow id={ID} />);
    const items = document.querySelectorAll('section[aria-labelledby="coupon-terms-title"] li');
    assert.equal(items.length, 3);
    assert.equal(items[1].textContent, '僅限本人使用');
  });

  test('店員掃碼券顯示「出示 QR Code 給店員」', () => {
    h.coupon = fanCoupon({}, { redeemMode: 'STAFF_SCAN', staffCodeLength: null });
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(button('出示 QR Code 給店員'));
    assert.ok(screen.queryByRole('button', { name: '立即使用' }) === null);
  });

  test('未到生效日：券號遮蔽、說明生效日、按鈕停用並寫出起用日', () => {
    h.coupon = fanCoupon({
      walletStatus: 'NOT_YET',
      code: null,
      codeHidden: true,
      availableAt: '2026-10-20T04:00:00.000Z',
    });
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.getByText('••••-••••-••••'));
    assert.ok(screen.getByText('10/20 起可使用，序號生效前不顯示'));
    const btn = button('2026-10-20 起可使用');
    assert.equal(btn.disabled, true);
  });

  test('已使用：不提供核銷動作，說明使用時間，按鈕為「關閉」', () => {
    h.coupon = fanCoupon({ walletStatus: 'USED', walletTab: 'used', status: 'REDEEMED', redeemedAt: '2026-10-05T06:31:07.000Z' });
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.queryByRole('button', { name: '立即使用' }) === null);
    assert.ok(screen.getByText(/此券已於 2026-10-05 \d\d:31:07 使用，無法再次核銷。/));
    fireEvent.click(button('關閉'));
    assert.deepEqual(h.router.push.mock.calls[0], ['/coupon/wallet']);
  });

  test('門市核銷的券，顧客查看時顯示核銷門市', () => {
    h.coupon = fanCoupon({
      walletStatus: 'USED', walletTab: 'used', status: 'REDEEMED',
      redeemedAt: '2026-10-05T06:31:07.000Z', redeemedStoreName: '內湖門市',
    });
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.getByText('使用門市'));
    assert.ok(screen.getByText('內湖門市'));
  });

  test('不是在門市核銷的已使用券不顯示使用門市', () => {
    h.coupon = fanCoupon({ walletStatus: 'USED', walletTab: 'used', status: 'REDEEMED', redeemedAt: '2026-10-05T06:31:07.000Z', redeemedStoreName: null });
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.queryByText('使用門市') === null);
  });

  test('已過期與活動已提前結束顯示各自說明', () => {
    h.coupon = fanCoupon({ walletStatus: 'EXPIRED', walletTab: 'invalid', expiresAt: '2026-09-30T08:00:00.000Z' });
    const { unmount } = render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.getByText('此券已於 2026-09-30 到期，無法使用。'));
    unmount();
    h.coupon = fanCoupon({ walletStatus: 'ENDED', walletTab: 'invalid' });
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.getByText('商家已提前結束活動，如有疑問請聯絡客服。'));
  });

  test('沒有顧客憑證時請顧客回到對話重新開啟', () => {
    h.token = null;
    h.coupon = null;
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.getByText('請回到對話，點選優惠券連結開啟'));
  });

  test('API 回 401 時也請顧客回到對話重新開啟', () => {
    h.coupon = null;
    h.error = apiError('UNAUTHORIZED', {}, 401);
    render(<CouponRedeemFlow id={ID} />);
    assert.ok(screen.getByText('請回到對話，點選優惠券連結開啟'));
  });
});

describe('店員驗證碼核銷', () => {
  async function openStaffCode(expiresInMs = 300_000) {
    h.start.mockResolvedValue({ expiresAt: new Date(Date.now() + expiresInMs).toISOString(), remainingMs: expiresInMs });
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('立即使用'));
    await flush();
  }

  test('手機時鐘比伺服器快 10 分鐘時，倒數仍以伺服器的剩餘時間為準', async () => {
    // 伺服器的結束時間換算成本機時間已經過去，但伺服器說還剩 5 分鐘
    h.start.mockResolvedValue({ expiresAt: new Date(Date.now() - 300_000).toISOString(), remainingMs: 300_000 });
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('立即使用'));
    await flush();
    assert.ok(screen.getByText('5:00'), '倒數應從 5:00 開始');
    assert.ok(screen.queryByText('核銷時間已結束') === null);
  });

  test('一天內錯誤太多次：開始使用時說明 24 小時內不能核銷', async () => {
    h.start.mockRejectedValue(apiError('TOO_MANY_ATTEMPTS', {}, 429));
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('立即使用'));
    await flush();
    assert.ok(screen.getByText('驗證碼錯誤次數過多，這張券 24 小時內不能核銷。如需協助請聯絡客服。'));
  });

  test('一天內錯誤太多次：送出驗證碼時說明，不顯示重試', async () => {
    await openStaffCode();
    h.redeemCode.mockRejectedValue(apiError('TOO_MANY_ATTEMPTS', {}, 429));
    fireEvent.change(codeInput(), { target: { value: '111222' } });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.ok(screen.getByText('驗證碼錯誤次數過多，這張券 24 小時內不能核銷。如需協助請聯絡客服。'));
    assert.ok(screen.queryByRole('button', { name: '重試' }) === null);
  });

  test('輸入格數等於 staffCodeLength', async () => {
    h.coupon = fanCoupon({}, { staffCodeLength: 4 });
    await openStaffCode();
    assert.ok(screen.getByRole('heading', { name: '確認核銷' }));
    assert.equal(document.querySelectorAll('[data-otp-cell]').length, 4);
    assert.equal(codeInput().maxLength, 4);
  });

  test('只接受數字；未填滿時「確認核銷」停用，填滿後可按', async () => {
    await openStaffCode();
    fireEvent.change(codeInput(), { target: { value: '12a3' } });
    assert.equal(codeInput().value, '123');
    assert.equal(button('確認核銷').disabled, true);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    assert.equal(button('確認核銷').disabled, false);
  });

  test('驗證碼錯誤：清空輸入、顯示錯誤與剩餘次數', async () => {
    await openStaffCode();
    h.redeemCode.mockRejectedValue(apiError('STAFF_CODE_MISMATCH', { attemptsLeft: 3 }));
    fireEvent.change(codeInput(), { target: { value: '111111' } });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.deepEqual(h.redeemCode.mock.calls[0], [ID, '111111']);
    assert.equal(codeInput().value, '');
    assert.ok(screen.getByText('驗證碼錯誤，請重新輸入'));
    assert.ok(screen.getByText(/還可以再試 3 次/));
  });

  test('錯誤達上限（時段被關閉）回到詳情並說明須重新開始', async () => {
    await openStaffCode();
    h.redeemCode.mockRejectedValue(apiError('SESSION_REQUIRED'));
    fireEvent.change(codeInput(), { target: { value: '111111' } });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.ok(screen.getByRole('heading', { name: '優惠券詳情' }));
    assert.ok(screen.getByText('錯誤次數過多，請重新開始'));
  });

  test('核銷成功切到核銷結果', async () => {
    await openStaffCode();
    h.redeemCode.mockResolvedValue({ redeemedAt: '2026-10-12T01:41:05.000Z' });
    fireEvent.change(codeInput(), { target: { value: '582917' } });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.ok(screen.getByRole('heading', { name: '核銷結果' }));
    assert.ok(screen.getByText(/2026-10-12 \d\d:41:05/));
    assert.ok(screen.getByText('店員驗證碼'));
  });

  test('倒數剩 60 秒內顯示警示，歸零切到「核銷時間已結束」', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T02:00:00.000Z'));
    await openStaffCode(65_000);
    assert.ok(screen.getByText('1:05'));
    assert.ok(screen.queryByText('剩餘 1 分鐘，請盡快完成') === null);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    assert.ok(screen.getByText('1:00'));
    assert.ok(screen.getByText('剩餘 1 分鐘，請盡快完成'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    assert.ok(screen.getByText('核銷時間已結束'));
    assert.ok(screen.getByText('券沒有被使用，可以返回後重新開始。'));
    fireEvent.click(button('返回票券詳情'));
    assert.ok(screen.getByRole('heading', { name: '優惠券詳情' }));
  });

  test('送出時發現另一裝置已核銷：重新抓資料並顯示已使用', async () => {
    await openStaffCode();
    h.redeemCode.mockRejectedValue(apiError('ALREADY_REDEEMED', { redeemedAt: '2026-10-05T06:31:07.000Z' }));
    fireEvent.change(codeInput(), { target: { value: '582917' } });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.equal(h.mutate.mock.calls.length > 0, true);
    assert.ok(screen.getByText(/此券已於 2026-10-05 \d\d:31:07 使用，無法再次核銷。/));
    assert.ok(screen.queryByRole('button', { name: '立即使用' }) === null);
  });

  test('網路錯誤顯示訊息並可重試', async () => {
    await openStaffCode();
    h.redeemCode.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    fireEvent.change(codeInput(), { target: { value: '582917' } });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.ok(screen.getByRole('alert').textContent?.includes('網路連線異常'));
    // 回應遺失時券可能已經核銷：不能告訴顧客「尚未被使用」
    assert.ok(!screen.getByRole('alert').textContent?.includes('尚未被使用'));
    assert.ok(screen.getByRole('alert').textContent?.includes('無法確認是否已核銷'));
    h.redeemCode.mockResolvedValueOnce({ redeemedAt: '2026-10-12T01:41:05.000Z' });
    fireEvent.click(button('確認核銷'));
    await flush();
    assert.ok(screen.getByRole('heading', { name: '核銷結果' }));
  });

  test('「取消，稍後使用」回到詳情', async () => {
    await openStaffCode();
    fireEvent.click(button('取消，稍後使用'));
    assert.ok(screen.getByRole('heading', { name: '優惠券詳情' }));
  });
});

describe('開啟後計時的券', () => {
  test('按「立即使用」先確認，確定後才開啟並進入核銷', async () => {
    h.coupon = fanCoupon({ expiresAt: null }, { validityMode: 'AFTER_OPEN', afterOpenMinutes: 30 });
    h.open.mockResolvedValue({ expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
    h.start.mockResolvedValue({ expiresAt: new Date(Date.now() + 300_000).toISOString(), remainingMs: 300_000 });
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('立即使用'));
    assert.ok(screen.getByText('開啟後須在 30 分鐘內使用，確定開啟？'));
    assert.equal(h.open.mock.calls.length, 0);
    fireEvent.click(button('確定開啟'));
    await flush();
    assert.deepEqual(h.open.mock.calls[0], [ID]);
    assert.ok(screen.getByRole('heading', { name: '確認核銷' }));
  });
});

describe('顧客自助滑動核銷', () => {
  function setupSelf() {
    h.coupon = fanCoupon({}, { redeemMode: 'SELF', staffCodeLength: null });
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('立即使用'));
    const track = document.querySelector('[data-slide-track]') as HTMLElement;
    track.getBoundingClientRect = () => ({ width: 353, left: 0, right: 353, top: 0, bottom: 48, height: 48, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return screen.getByRole('slider');
  }

  test('未滑過 90% 放開會彈回，不呼叫核銷', async () => {
    const handle = setupSelf();
    fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 210, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 210, pointerId: 1 });
    await flush();
    assert.equal(h.redeemSelf.mock.calls.length, 0);
    assert.equal(handle.getAttribute('aria-valuenow'), '0');
  });

  test('滑過 90% 放開呼叫 redeemSelf 並切到核銷結果', async () => {
    h.redeemSelf.mockResolvedValue({ redeemedAt: '2026-10-12T01:41:05.000Z' });
    const handle = setupSelf();
    fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 340, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 340, pointerId: 1 });
    await flush();
    assert.deepEqual(h.redeemSelf.mock.calls[0], [ID]);
    assert.ok(screen.getByRole('heading', { name: '核銷結果' }));
    assert.ok(screen.getByText('顧客自助'));
  });

  test('網路錯誤：不說券尚未被使用，請顧客重新查看', async () => {
    h.redeemSelf.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    const handle = setupSelf();
    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    await flush();
    const alert = screen.getByRole('alert').textContent ?? '';
    assert.ok(!alert.includes('尚未被使用'), alert);
    assert.ok(alert.includes('無法確認是否已核銷'), alert);
    assert.ok(h.mutate.mock.calls.length > 0, '重新讀取券的狀態');
  });

  test('伺服器拒絕（例如 400）：券確定沒被使用，可再試', async () => {
    h.redeemSelf.mockRejectedValueOnce(apiError('VALIDATION_ERROR', {}, 400));
    const handle = setupSelf();
    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    await flush();
    assert.ok(screen.getByRole('alert').textContent?.includes('尚未被使用'));
  });

  test('鍵盤：聚焦把手後按 Enter 兩次確認', async () => {
    h.redeemSelf.mockResolvedValue({ redeemedAt: '2026-10-12T01:41:05.000Z' });
    const handle = setupSelf();
    fireEvent.keyDown(handle, { key: 'Enter' });
    await flush();
    assert.equal(h.redeemSelf.mock.calls.length, 0);
    fireEvent.keyDown(handle, { key: 'Enter' });
    await flush();
    assert.equal(h.redeemSelf.mock.calls.length, 1);
  });
});

describe('店員掃碼', () => {
  test('出示 QR 時每 3 秒輪詢，偵測到已使用切到核銷結果', async () => {
    h.coupon = fanCoupon({ code: 'AUTUMN-R9XU-X9RG' }, { redeemMode: 'STAFF_SCAN', staffCodeLength: null });
    h.qr.mockResolvedValue('data:image/png;base64,AAAA');
    const { rerender } = render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('出示 QR Code 給店員'));
    await flush();
    assert.ok(screen.getByRole('heading', { name: '出示QR Code' }));
    assert.equal((screen.getByAltText(/QR Code/) as HTMLImageElement).src, 'data:image/png;base64,AAAA');
    assert.equal(h.refreshMs.at(-1), 3000);

    h.coupon = fanCoupon(
      { code: 'AUTUMN-R9XU-X9RG', walletStatus: 'USED', walletTab: 'used', status: 'REDEEMED', redeemedAt: '2026-10-12T01:41:05.000Z', redeemedStoreName: '內湖門市' },
      { redeemMode: 'STAFF_SCAN', staffCodeLength: null },
    );
    rerender(<CouponRedeemFlow id={ID} />);
    await flush();
    assert.ok(screen.getByRole('heading', { name: '核銷結果' }));
    assert.ok(screen.getByText('店員掃碼'));
    assert.ok(screen.getByText('內湖門市'));
  });

  test('共用碼券：「無法掃描請輸入券號」顯示這張券自己的券號，不是共用碼', async () => {
    h.coupon = fanCoupon({ code: 'SUMMER2026', scanCode: 'SUMMER2026-K7P24M9XQR' }, { redeemMode: 'STAFF_SCAN', staffCodeLength: null });
    h.qr.mockResolvedValue('data:image/png;base64,AAAA');
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('出示 QR Code 給店員'));
    await flush();
    assert.ok(screen.getByText('SUMMER2026-K7P24M9XQR'));
  });

  test('QR 取得失敗顯示錯誤並可重試', async () => {
    h.coupon = fanCoupon({}, { redeemMode: 'STAFF_SCAN', staffCodeLength: null });
    h.qr.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    render(<CouponRedeemFlow id={ID} />);
    fireEvent.click(button('出示 QR Code 給店員'));
    await flush();
    assert.ok(screen.getByRole('alert'));
    h.qr.mockResolvedValueOnce('data:image/png;base64,BBBB');
    fireEvent.click(button('重試'));
    await flush();
    assert.ok(screen.getByAltText(/QR Code/));
  });
});
