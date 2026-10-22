// @vitest-environment jsdom
/**
 * 票券連結入口頁（/coupon/open/{token}）。
 * spec coupon-redemption「顧客須完成歸戶驗證才能開啟票券夾」「票券連結」；design D12。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  const router = { push, replace: vi.fn(), back: vi.fn() };
  return {
    router,
    push,
    openWalletSession: vi.fn(),
    requestWalletEmailCode: vi.fn(),
    verifyWalletEmailCode: vi.fn(),
    useFanCoupon: vi.fn(),
    getFanDeviceTokens: vi.fn(),
    rememberFanDeviceToken: vi.fn(),
    setFanToken: vi.fn(),
    getFanToken: vi.fn(),
    mutate: vi.fn(),
  };
});

vi.mock('#src/hooks/useFanCoupons.js', () => ({
  openWalletSession: mocks.openWalletSession,
  requestWalletEmailCode: mocks.requestWalletEmailCode,
  verifyWalletEmailCode: mocks.verifyWalletEmailCode,
  useFanCoupon: mocks.useFanCoupon,
}));
vi.mock('#src/lib/fan-device.js', () => ({
  getFanDeviceTokens: mocks.getFanDeviceTokens,
  rememberFanDeviceToken: mocks.rememberFanDeviceToken,
}));
vi.mock('#src/lib/fan-api.js', () => ({
  default: {},
  setFanToken: mocks.setFanToken,
  getFanToken: mocks.getFanToken,
}));
// 回傳同一個 router 物件，模擬真正 hook 每次 render 都穩定
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));

import { CouponEntry } from '#src/components/fan-coupon/entry/CouponEntry.js';
import type { FanCoupon } from '#src/hooks/useFanCoupons.js';

const TOKEN = 'tok_abc';

function coupon(overrides: Partial<FanCoupon> = {}, couponOverrides: Partial<FanCoupon['coupon']> = {}): FanCoupon {
  return {
    id: 'inst-1',
    code: 'ABCD-EFGH-IJKL',
    codeHidden: false,
    availableAt: null,
    status: 'CLAIMED',
    walletStatus: 'AVAILABLE',
    walletTab: 'available',
    daysLeft: null,
    expiresAt: '2026-10-31T15:59:59.000Z',
    claimedAt: '2026-10-01T00:00:00.000Z',
    openedAt: null,
    redeemedAt: null,
    coupon: {
      name: '秋季回饋 滿千折百',
      description: null,
      terms: null,
      imageUrl: null,
      couponType: 'DISCOUNT_AMOUNT',
      discountAmount: 100,
      discountPercent: null,
      minSpend: 1000,
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
      ...couponOverrides,
    },
    ...overrides,
  };
}

const httpError = (status: number, code?: string, details?: Record<string, unknown>) =>
  Object.assign(new Error(String(status)), {
    response: { status, data: code ? { success: false, error: { code, message: code, details } } : undefined },
  });

let originalLocation: Location;

beforeEach(() => {
  for (const fn of [
    mocks.push, mocks.openWalletSession, mocks.useFanCoupon, mocks.setFanToken, mocks.getFanToken,
    mocks.requestWalletEmailCode, mocks.verifyWalletEmailCode, mocks.getFanDeviceTokens, mocks.rememberFanDeviceToken,
  ]) fn.mockReset();
  mocks.useFanCoupon.mockReturnValue({ coupon: null, error: undefined, isLoading: false, mutate: mocks.mutate });
  mocks.getFanToken.mockReturnValue(null);
  mocks.getFanDeviceTokens.mockReturnValue([]);
  originalLocation = window.location;
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

test('已驗證的裝置開啟票券連結：帶上裝置憑證，存下顧客憑證與換新的裝置憑證並顯示這張券', async () => {
  mocks.getFanDeviceTokens.mockReturnValue(['device-old']);
  mocks.openWalletSession.mockResolvedValue({
    status: 'ok', fanToken: 'fan-jwt', tenantId: 't', contactId: 'c', instanceId: 'inst-1', deviceToken: 'device-new',
  });
  mocks.useFanCoupon.mockImplementation((id: string | null) => ({
    coupon: id === 'inst-1' ? coupon() : null,
    error: undefined,
    isLoading: false,
    mutate: mocks.mutate,
  }));
  render(<CouponEntry token={TOKEN} />);

  await screen.findByText('已存入我的優惠券');
  assert.deepEqual(mocks.openWalletSession.mock.calls[0], [TOKEN, ['device-old']]);
  assert.deepEqual(mocks.setFanToken.mock.calls[0], ['fan-jwt']);
  assert.deepEqual(mocks.rememberFanDeviceToken.mock.calls, [['device-new']]);
  assert.ok(screen.getByText('秋季回饋 滿千折百'));
  assert.ok(screen.getByText(/到門市結帳時/));

  fireEvent.click(screen.getByRole('button', { name: '查看此票券' }));
  assert.deepEqual(mocks.push.mock.calls.at(-1), ['/coupon/wallet/inst-1']);
  fireEvent.click(screen.getByRole('button', { name: '查看票券匣' }));
  assert.deepEqual(mocks.push.mock.calls.at(-1), ['/coupon/wallet']);
});

// 設計稿 C2.1 原為「在線上商城結帳時」；但表單建議顧客自助用於無人商店、活動快閃等實體場景，
// 操作手冊實測（2026-10-22）改為不限線上或門市的說明
test('顧客自助券：說明不限定線上或門市', async () => {
  mocks.openWalletSession.mockResolvedValue({ status: 'ok', fanToken: 'fan-jwt', tenantId: 't', contactId: 'c', instanceId: 'inst-1' });
  mocks.useFanCoupon.mockReturnValue({ coupon: coupon({}, { redeemMode: 'SELF' }), error: undefined, isLoading: false, mutate: mocks.mutate });
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText('結帳時，打開「我的優惠券」即可使用。');
  assert.ok(screen.queryByText(/線上商城|到門市結帳時/) === null);
});

test('未歸戶的顧客開啟票券連結：引導前往手機登記，不存憑證', async () => {
  const registrationUrl = '/bind/phone/R123?next=/coupon/open/tok_abc';
  mocks.openWalletSession.mockResolvedValue({ status: 'verification_required', kind: 'phone', registrationUrl });
  const location = { href: 'http://localhost/coupon/open/tok_abc' };
  Object.defineProperty(window, 'location', { configurable: true, value: location });
  render(<CouponEntry token={TOKEN} />);

  await screen.findByText('請先完成身分驗證');
  assert.ok(screen.getByText(/第一次開啟前請先登記手機號碼/));
  assert.equal(mocks.setFanToken.mock.calls.length, 0);
  fireEvent.click(screen.getByRole('button', { name: '前往驗證' }));
  assert.equal(location.href, registrationUrl);
});

test('要求 email 驗證時，說明改為 email', async () => {
  mocks.openWalletSession.mockResolvedValue({ status: 'verification_required', kind: 'email', registrationUrl: '/bind/email/R?next=/coupon/open/tok_abc' });
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText(/第一次開啟前請先登記 email/);
});

test('租戶沒有啟用任何登記方式：請顧客聯絡客服', async () => {
  mocks.openWalletSession.mockResolvedValue({ status: 'unavailable' });
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText('目前無法開啟優惠券');
  assert.ok(screen.getByText('商家尚未開啟身分驗證，請在對話中聯絡客服。'));
  assert.ok(screen.queryByRole('button', { name: '前往驗證' }) === null);
});

test('取得驗證連結太多次：請稍候再試', async () => {
  mocks.openWalletSession.mockResolvedValue({ status: 'rate_limited' });
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText('操作次數過多');
  assert.ok(screen.getByText('請稍候一小時後再試，或在對話中聯絡客服。'));
});

test('連結失效（410）且沒有顧客憑證：不顯示查看票券匣', async () => {
  mocks.openWalletSession.mockRejectedValue(httpError(410));
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText('連結已失效');
  assert.ok(screen.getByText(/連結可能已過期或不完整/));
  assert.ok(screen.queryByRole('button', { name: '查看票券匣' }) === null);
});

test('連結失效（410）但已有顧客憑證：可以查看票券匣', async () => {
  mocks.getFanToken.mockReturnValue('fan-jwt');
  mocks.openWalletSession.mockRejectedValue(httpError(410));
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText('連結已失效');
  fireEvent.click(screen.getByRole('button', { name: '查看票券匣' }));
  assert.deepEqual(mocks.push.mock.calls.at(-1), ['/coupon/wallet']);
});

test('網路錯誤：顯示錯誤並可重試', async () => {
  mocks.openWalletSession.mockRejectedValueOnce(new Error('Network Error'));
  mocks.openWalletSession.mockResolvedValueOnce({ status: 'unavailable' });
  render(<CouponEntry token={TOKEN} />);
  await screen.findByText('無法連線，請稍後再試');
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByText('目前無法開啟優惠券');
  assert.equal(mocks.openWalletSession.mock.calls.length, 2);
});

test('回到 LINE：無法關閉分頁時提示自行關閉', async () => {
  mocks.openWalletSession.mockResolvedValue({ status: 'unavailable', channelType: 'LINE' });
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});
  try {
    render(<CouponEntry token={TOKEN} />);
    await screen.findByText('目前無法開啟優惠券');
    assert.ok(screen.queryByText('請直接關閉此頁面') === null);
    fireEvent.click(screen.getByRole('button', { name: '回到 LINE' }));
    assert.equal(close.mock.calls.length, 1);
    await screen.findByText('請直接關閉此頁面', undefined, { timeout: 2000 });
  } finally {
    close.mockRestore();
  }
});

describe('票券頁依顧客的渠道顯示返回文字', () => {
  for (const [channelType, label] of [['LINE', '回到 LINE'], ['FB', '回到 Messenger'], ['THREADS', '回到 Instagram'], ['WEBCHAT', '回到對話'], [null, '回到對話']] as const) {
    test(`${channelType ?? '不知道渠道'}：${label}`, async () => {
      mocks.openWalletSession.mockResolvedValue({ status: 'unavailable', channelType });
      render(<CouponEntry token={TOKEN} />);
      await screen.findByText('目前無法開啟優惠券');
      assert.ok(screen.getByRole('button', { name: label }));
      if (channelType !== 'LINE') assert.ok(screen.queryByText(/LINE/) === null);
    });
  }

  test('連結失效時不知道渠道：請顧客回到對話重新點選', async () => {
    mocks.openWalletSession.mockRejectedValue(httpError(410));
    render(<CouponEntry token={TOKEN} />);
    await screen.findByText('連結已失效');
    assert.ok(screen.getByText(/請回到對話重新點選/));
    assert.ok(screen.queryByText(/LINE/) === null);
  });
});


describe('新裝置或轉傳的連結：以原 email 驗證碼確認身分（design D24）', () => {
  const okSession = {
    status: 'ok', fanToken: 'fan-jwt', tenantId: 't', contactId: 'c', instanceId: 'inst-1', channelType: 'FB', deviceToken: 'device-new',
  };

  async function openCodeStep() {
    mocks.openWalletSession.mockResolvedValue({ status: 'email_code_required', maskedEmail: 'd***@aicreate360.com', channelType: 'FB' });
    render(<CouponEntry token={TOKEN} />);
    await screen.findByText(/為了確認是你本人，我們會寄 6 位數驗證碼到 d\*\*\*@aicreate360\.com/);
  }

  async function sendCode() {
    mocks.requestWalletEmailCode.mockResolvedValueOnce({ status: 'code_sent', maskedEmail: 'd***@aicreate360.com' });
    fireEvent.click(screen.getByRole('button', { name: '寄送驗證碼' }));
    return screen.findByLabelText('驗證碼');
  }

  test('顯示遮蔽後的 email，不能輸入其他 email，不存憑證', async () => {
    await openCodeStep();
    assert.equal(mocks.setFanToken.mock.calls.length, 0);
    assert.ok(screen.queryByLabelText(/email/i) === null, '不提供輸入 email 的欄位');
    assert.ok(screen.getByRole('button', { name: '回到 Messenger' }));
  });

  test('寄出驗證碼後輸入正確：存下顧客憑證與裝置憑證並顯示這張券', async () => {
    mocks.useFanCoupon.mockReturnValue({ coupon: coupon(), error: undefined, isLoading: false, mutate: mocks.mutate });
    await openCodeStep();
    const input = await sendCode();
    assert.deepEqual(mocks.requestWalletEmailCode.mock.calls[0], [TOKEN]);
    assert.ok(screen.getByText(/已寄出 6 位數驗證碼到 d\*\*\*@aicreate360\.com/));

    mocks.verifyWalletEmailCode.mockResolvedValueOnce(okSession);
    fireEvent.change(input, { target: { value: ' 123456 ' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('已存入我的優惠券');
    assert.deepEqual(mocks.verifyWalletEmailCode.mock.calls[0], [TOKEN, '123456']);
    assert.deepEqual(mocks.setFanToken.mock.calls[0], ['fan-jwt']);
    assert.deepEqual(mocks.rememberFanDeviceToken.mock.calls, [['device-new']]);
  });

  test('驗證碼錯誤：顯示錯誤與剩餘次數，可再輸入', async () => {
    await openCodeStep();
    const input = await sendCode();
    mocks.verifyWalletEmailCode.mockRejectedValueOnce(httpError(400, 'INVALID_VERIFICATION_CODE', { remainingAttempts: 4 }));
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('驗證碼錯誤，還可以再試 4 次');
    assert.ok(screen.getByLabelText('驗證碼'));
    assert.equal(mocks.setFanToken.mock.calls.length, 0);
  });

  test('錯太多次：請顧客重新寄送', async () => {
    await openCodeStep();
    const input = await sendCode();
    mocks.verifyWalletEmailCode.mockRejectedValueOnce(httpError(429, 'VERIFICATION_CODE_LOCKED'));
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('驗證碼錯誤次數過多，請重新寄送驗證碼');
  });

  test('驗證碼過期：請顧客重新寄送', async () => {
    await openCodeStep();
    const input = await sendCode();
    mocks.verifyWalletEmailCode.mockRejectedValueOnce(httpError(410, 'VERIFICATION_CODE_EXPIRED'));
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('驗證碼已過期，請重新寄送');
  });

  test('寄送太多次：請稍後再試', async () => {
    await openCodeStep();
    mocks.requestWalletEmailCode.mockRejectedValueOnce(httpError(429, 'TOO_MANY_VERIFICATION_EMAILS'));
    fireEvent.click(screen.getByRole('button', { name: '寄送驗證碼' }));
    await screen.findByText('寄送次數過多，請 10 分鐘後再試');
  });

  test('寄信失敗：顯示錯誤，可以再寄', async () => {
    await openCodeStep();
    mocks.requestWalletEmailCode.mockRejectedValueOnce(httpError(502, 'VERIFICATION_EMAIL_FAILED'));
    fireEvent.click(screen.getByRole('button', { name: '寄送驗證碼' }));
    await screen.findByText('驗證信寄送失敗，請稍後再試');
    assert.ok(!(screen.getByRole('button', { name: '寄送驗證碼' }) as HTMLButtonElement).disabled);
  });

  test('寄出後重新寄送要等冷卻時間', async () => {
    await openCodeStep();
    await sendCode();
    const resend = screen.getByRole('button', { name: /重新寄送/ }) as HTMLButtonElement;
    assert.ok(resend.disabled, '剛寄出不能馬上重寄');
    assert.match(resend.textContent ?? '', /\d+ 秒/);
  });

  test('連結失效：顯示連結已失效', async () => {
    await openCodeStep();
    mocks.requestWalletEmailCode.mockRejectedValueOnce(httpError(410, 'LINK_EXPIRED'));
    fireEvent.click(screen.getByRole('button', { name: '寄送驗證碼' }));
    await screen.findByText('連結已失效');
  });
});
