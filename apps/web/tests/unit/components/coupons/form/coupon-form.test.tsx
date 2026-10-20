// @vitest-environment jsdom
/**
 * 建立／編輯優惠券表單（openspec tasks 8.21；Jira CM-196「驗證碼、發布流程、離開提醒、草稿」）。
 * 替換 API、優惠券資料 hook、登入狀態與 Next.js 路由，只測使用者看得到的行為。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, coupons, router } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  coupons: {
    createCoupon: vi.fn(),
    updateCoupon: vi.fn(),
    publishCoupon: vi.fn(),
    checkSharedCode: vi.fn(),
    previewCodeImport: vi.fn(),
    importCodes: vi.fn(),
  },
  // 真正的 router 每次 render 回傳同一個物件；mock 也要如此，避免 effect 無限重跑
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));

vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/hooks/useCoupons.js', () => coupons);
vi.mock('#src/providers/AuthProvider.js', () => ({
  useAuth: () => ({ hasPermission: () => true }),
  usePermission: () => true,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/marketing/coupons/new',
  useSearchParams: () => new URLSearchParams(),
}));

import { CouponForm } from '#src/components/coupons/form/CouponForm.js';
import type { Coupon } from '#src/hooks/useCoupons.js';

const LIST_HREF = '/dashboard/marketing/coupons';

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c1',
    displayCode: 'CP-ABC234',
    name: '秋季回饋 滿千折百',
    description: null,
    terms: '限直營門市使用',
    imageUrl: null,
    couponType: 'DISCOUNT_AMOUNT',
    purpose: 'MARKETING',
    discountAmount: 100,
    discountPercent: null,
    minSpend: 1000,
    percentCap: null,
    giftName: null,
    giftQty: null,
    exchangeItem: null,
    exchangeValueCap: null,
    validityMode: 'AFTER_CLAIM',
    startAt: null,
    endAt: null,
    afterClaimDays: 30,
    afterOpenMinutes: null,
    codeMode: 'UNIQUE_CODE',
    sharedCode: null,
    codePrefix: 'AUTUMN',
    redeemMode: 'STAFF_CODE',
    staffCode: '582917',
    totalLimit: 1000,
    perContactLimit: 1,
    claimTagId: null,
    claimTagTtlDays: null,
    maskCodeBeforeStart: true,
    status: 'DRAFT',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url: string) => {
    if (url === '/tags') return Promise.resolve({ data: { success: true, data: [] } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  coupons.updateCoupon.mockImplementation((id: string) => Promise.resolve(coupon({ id })));
  coupons.createCoupon.mockResolvedValue(coupon({ id: 'new-1' }));
  coupons.publishCoupon.mockResolvedValue(undefined);
  coupons.checkSharedCode.mockResolvedValue({ available: true });
});

function publishButton() {
  return screen.getByRole('button', { name: '發布優惠券' });
}

describe('發布確認框', () => {
  test('列出發布後鎖定的設定，驗證碼模式另起一行「店員驗證碼：xxxxxx（發布後無法修改）」', async () => {
    render(<CouponForm mode="draft" coupon={coupon()} />);
    fireEvent.click(publishButton());

    const dialog = await screen.findByRole('alertdialog');
    assert.ok(within(dialog).getByText('確認發布優惠券？'));
    for (const label of ['券型與面額', '效期', '序號模式', '核銷方式']) {
      assert.ok(within(dialog).getByText(label), `缺少鎖定設定：${label}`);
    }
    assert.ok(within(dialog).getByText('元折抵 · 折 NT$100 · 滿 NT$1,000'));
    assert.ok(within(dialog).getByText('店員驗證碼：582917（發布後無法修改）'));
  });

  test('確認發布：先存檔再發布，成功後導到詳情並帶 published=1', async () => {
    render(<CouponForm mode="draft" coupon={coupon()} />);
    fireEvent.click(publishButton());
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認發布' }));

    await waitFor(() => assert.equal(router.push.mock.calls.length, 1));
    assert.equal(router.push.mock.calls[0][0], `${LIST_HREF}/c1?published=1`);
    assert.equal(coupons.updateCoupon.mock.calls[0][0], 'c1');
    assert.equal(coupons.updateCoupon.mock.calls[0][1].staffCode, '582917');
    assert.deepEqual(coupons.publishCoupon.mock.calls[0], ['c1']);
  });

  test('發布失敗時留在確認框，顯示「發布失敗」與後端訊息，可重試', async () => {
    coupons.publishCoupon.mockRejectedValueOnce({
      response: { status: 400, data: { error: { code: 'VALIDATION_ERROR', message: '到期日已過，無法發布' } } },
    });
    render(<CouponForm mode="draft" coupon={coupon()} />);
    fireEvent.click(publishButton());
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '確認發布' }));

    const dialog = await screen.findByRole('alertdialog');
    await within(dialog).findByText('發布失敗');
    assert.ok(within(dialog).getByText(/到期日已過，無法發布/));
    assert.equal(router.push.mock.calls.length, 0);

    fireEvent.click(within(dialog).getByRole('button', { name: '重試' }));
    await waitFor(() => assert.equal(router.push.mock.calls.length, 1));
    assert.equal(coupons.publishCoupon.mock.calls.length, 2);
  });

  test('有風險項目時，未勾「我已確認」不能按確認發布', async () => {
    // 不限總量 → 一項風險
    render(<CouponForm mode="draft" coupon={coupon({ totalLimit: null })} />);
    fireEvent.click(publishButton());
    const dialog = await screen.findByRole('alertdialog');

    assert.ok(within(dialog).getByText('不限總量'));
    assert.ok(within(dialog).getByText('最壞成本'));
    const confirm = within(dialog).getByRole('button', { name: '確認發布' }) as HTMLButtonElement;
    assert.equal(confirm.disabled, true);
    fireEvent.click(confirm);
    assert.equal(coupons.publishCoupon.mock.calls.length, 0);

    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已確認以上 1 項設定與最壞成本' }));
    assert.equal(confirm.disabled, false);
  });

  test('按下確認後顯示「發布中…」並停用，連點只送一次', async () => {
    let resolvePublish: () => void = () => {};
    coupons.publishCoupon.mockImplementation(() => new Promise<void>((r) => (resolvePublish = r)));
    render(<CouponForm mode="draft" coupon={coupon()} />);
    fireEvent.click(publishButton());
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: '確認發布' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const busy = (await within(dialog).findByRole('button', { name: '發布中…' })) as HTMLButtonElement;
    assert.equal(busy.disabled, true);
    assert.equal((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled, true);
    await act(async () => resolvePublish());
    assert.equal(coupons.updateCoupon.mock.calls.length, 1);
    assert.equal(coupons.publishCoupon.mock.calls.length, 1);
  });
});

describe('店員驗證碼', () => {
  function pinInput() {
    return screen.getByLabelText(/^店員驗證碼/) as HTMLInputElement;
  }

  test('輸入 123456 顯示「請避免使用連續或重複的數字」', () => {
    render(<CouponForm mode="draft" coupon={coupon({ staffCode: null })} />);
    fireEvent.change(pinInput(), { target: { value: '123456' } });
    fireEvent.blur(pinInput());
    assert.ok(screen.getByText('請避免使用連續或重複的數字'));
  });

  test('輸入 123 顯示「需 4–6 位數字」', () => {
    render(<CouponForm mode="draft" coupon={coupon({ staffCode: null })} />);
    fireEvent.change(pinInput(), { target: { value: '123' } });
    fireEvent.blur(pinInput());
    assert.ok(screen.getByText(/需 4–6 位數字/));
  });

  test('只收數字並保留開頭的 0', () => {
    render(<CouponForm mode="draft" coupon={coupon({ staffCode: null })} />);
    fireEvent.change(pinInput(), { target: { value: '08a2741' } });
    assert.equal(pinInput().value, '082741');
  });
});

describe('必填檢查', () => {
  test('必填未完成時按發布：顯示「尚有 N 個必填欄位」、標出未填欄位，不開確認框', () => {
    render(<CouponForm mode="create" />);
    assert.ok(screen.getByRole('button', { name: /尚有 \d+ 個必填欄位/ }));

    fireEvent.click(publishButton());
    assert.ok(screen.queryByRole('alertdialog') === null);
    assert.ok(screen.getAllByText('此欄位必填').length > 0);
    // 聚焦到第一個未填欄位（券名稱）
    assert.equal(document.activeElement, screen.getByLabelText(/^券名稱/));
  });

  test('儲存草稿只要求券名：未填時提示「請先填寫優惠券名稱」且不送出', () => {
    render(<CouponForm mode="create" />);
    fireEvent.click(screen.getByRole('button', { name: '儲存草稿' }));
    assert.ok(screen.getByText('請先填寫優惠券名稱'));
    assert.equal(coupons.createCoupon.mock.calls.length, 0);
  });

  test('儲存草稿成功回到列表', async () => {
    render(<CouponForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '冬季草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存草稿' }));
    await waitFor(() => assert.equal(router.push.mock.calls.length, 1));
    assert.equal(coupons.createCoupon.mock.calls[0][0].name, '冬季草稿');
    assert.match(router.push.mock.calls[0][0], /^\/dashboard\/marketing\/coupons\?/);
  });

  test('儲存草稿失敗時保留內容並顯示「儲存草稿失敗：…」', async () => {
    coupons.createCoupon.mockRejectedValueOnce({ code: 'ERR_NETWORK', message: 'Network Error' });
    render(<CouponForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '冬季草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存草稿' }));
    assert.ok(await screen.findByText(/^儲存草稿失敗：/));
    assert.equal((screen.getByLabelText(/^券名稱/) as HTMLInputElement).value, '冬季草稿');
    assert.ok(screen.getByRole('button', { name: '重試' }));
  });
});

describe('編輯已發布的券', () => {
  test('鎖定欄位唯讀並說明「優惠券發布後無法修改」，可改欄位仍可輸入', () => {
    render(<CouponForm mode="published" coupon={coupon({ status: 'ACTIVE' })} claimedCount={12} issuedCount={20} />);

    const amountCard = screen.getByRole('radio', { name: /元折抵/ });
    assert.equal(amountCard.getAttribute('aria-disabled'), 'true');
    assert.equal((screen.getByLabelText(/^折抵金額/) as HTMLInputElement).readOnly, true);
    assert.equal((screen.getByLabelText(/^店員驗證碼/) as HTMLInputElement).readOnly, true);
    assert.equal((screen.getByLabelText(/^券號前綴/) as HTMLInputElement).readOnly, true);
    assert.ok(screen.getAllByText('優惠券發布後無法修改').length > 0);

    assert.equal((screen.getByLabelText(/^券名稱/) as HTMLInputElement).readOnly, false);
    assert.ok(screen.getByRole('button', { name: '儲存變更' }));
    assert.ok(screen.queryByRole('button', { name: '儲存草稿' }) === null);
  });

  test('儲存只送有改動的欄位，成功後導到詳情並帶 updated=1', async () => {
    render(<CouponForm mode="published" coupon={coupon({ status: 'ACTIVE' })} claimedCount={12} issuedCount={20} />);
    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '秋季回饋 加碼' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    await waitFor(() => assert.equal(router.push.mock.calls.length, 1));
    assert.deepEqual(coupons.updateCoupon.mock.calls[0], ['c1', { name: '秋季回饋 加碼' }]);
    assert.equal(router.push.mock.calls[0][0], `${LIST_HREF}/c1?updated=1`);
  });

  test('發行總量低於已發放時，後端訊息顯示在欄位下', async () => {
    coupons.updateCoupon.mockRejectedValueOnce({
      response: { status: 400, data: { error: { code: 'VALIDATION_ERROR', message: '不能低於已發放的 20 張' } } },
    });
    render(<CouponForm mode="published" coupon={coupon({ status: 'ACTIVE' })} claimedCount={12} issuedCount={10} />);
    fireEvent.change(screen.getByLabelText(/^發行總量上限/), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    assert.ok(await screen.findByText('不能低於已發放的 20 張'));
    assert.equal(router.push.mock.calls.length, 0);
  });
});

describe('離開提醒', () => {
  test('沒有修改時按取消直接回列表，不跳確認', () => {
    render(<CouponForm mode="create" />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    assert.ok(screen.queryByRole('alertdialog') === null);
    assert.equal(router.push.mock.calls[0][0], LIST_HREF);
  });

  test('有修改時按取消，跳出「尚未完成優惠券建立」', () => {
    render(<CouponForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '改了' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    const dialog = screen.getByRole('alertdialog');
    assert.ok(within(dialog).getByText('尚未完成優惠券建立'));
    assert.ok(within(dialog).getByText('離開後，尚未儲存的內容將會遺失。'));
    for (const name of ['繼續編輯', '放棄建立', '儲存草稿']) {
      assert.ok(within(dialog).getByRole('button', { name }));
    }
    assert.equal(router.push.mock.calls.length, 0);
  });

  test('有修改時點站內連結會被攔下；放棄建立後才前往該連結', () => {
    render(
      <>
        <a href="/dashboard/inbox">收件匣</a>
        <CouponForm mode="create" />
      </>,
    );
    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '改了' } });
    const notPrevented = fireEvent.click(screen.getByText('收件匣'));
    assert.equal(notPrevented, false);

    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '放棄建立' }));
    assert.equal(router.push.mock.calls[0][0], '/dashboard/inbox');
  });

  test('沒有修改時點站內連結不攔截', () => {
    render(
      <>
        <a href="/dashboard/inbox" onClick={(e) => e.preventDefault()}>收件匣</a>
        <CouponForm mode="create" />
      </>,
    );
    fireEvent.click(screen.getByText('收件匣'));
    assert.ok(screen.queryByRole('alertdialog') === null);
  });

  test('已發布的券有修改時，標題為「尚未儲存變更」', () => {
    render(<CouponForm mode="published" coupon={coupon({ status: 'ACTIVE' })} claimedCount={0} issuedCount={0} />);
    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '改了' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    const dialog = screen.getByRole('alertdialog');
    assert.ok(within(dialog).getByText('尚未儲存變更'));
    assert.ok(within(dialog).getByRole('button', { name: '放棄修改' }));
    assert.ok(within(dialog).getByRole('button', { name: '儲存變更' }));
  });

  test('有修改時重新整理或關分頁會觸發瀏覽器原生提醒', () => {
    render(<CouponForm mode="create" />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    assert.equal(clean.defaultPrevented, false);

    fireEvent.change(screen.getByLabelText(/^券名稱/), { target: { value: '改了' } });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    assert.equal(dirty.defaultPrevented, true);
  });
});
