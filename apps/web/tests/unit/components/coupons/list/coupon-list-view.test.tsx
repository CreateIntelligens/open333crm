// @vitest-environment jsdom
/**
 * 優惠券列表（《優惠券後台 UX 規則》第 2、5 節）。
 * 替換 useCoupons、登入成員權限與路由，只測畫面行為。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { state, coupons, auth, router } = vi.hoisted(() => {
  const mutate = () => Promise.resolve(undefined);
  // hook 回傳的函式在每次 render 都要相同（與真實 provider 的 useCallback 一致）
  const auth = {
    perms: new Set<string>(['coupon.view', 'coupon.manage']),
    hasPermission: (code: string) => auth.perms.has(code),
  };
  return {
    state: {
      list: [] as unknown[],
      statusCounts: { ALL: 0, ACTIVE: 0, PAUSED: 0, DRAFT: 0, ENDED: 0 },
      total: 0,
      allTotal: 0,
      error: undefined as unknown,
      isLoading: false,
    },
    coupons: {
      mutate: vi.fn(mutate),
      pauseCoupon: vi.fn(),
      resumeCoupon: vi.fn(),
      endCoupon: vi.fn(),
      duplicateCoupon: vi.fn(),
      deleteCoupon: vi.fn(),
    },
    auth,
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  };
});

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('#src/hooks/useCoupons.js', () => ({
  useCoupons: (params: { q?: string; status?: string; page?: number } = {}) => {
    const unfiltered = !params.q && !params.status;
    return {
      coupons: state.list,
      meta: state.isLoading || state.error
        ? undefined
        : {
            total: unfiltered ? state.allTotal : state.total,
            page: 1,
            limit: 50,
            statusCounts: state.statusCounts,
          },
      error: state.error,
      isLoading: state.isLoading,
      mutate: coupons.mutate,
    };
  },
  pauseCoupon: coupons.pauseCoupon,
  resumeCoupon: coupons.resumeCoupon,
  endCoupon: coupons.endCoupon,
  duplicateCoupon: coupons.duplicateCoupon,
  deleteCoupon: coupons.deleteCoupon,
}));
vi.mock('#src/providers/AuthProvider.js', () => ({
  useAuth: () => ({ hasPermission: auth.hasPermission, isLoading: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/marketing/coupons',
}));

import { CouponListView, type CouponListQuery } from '#src/components/coupons/list/CouponListView.js';

function coupon(over: Record<string, unknown>) {
  return {
    id: 'c-1',
    displayCode: 'MKT-AUTUMN-100',
    name: '秋季回饋 滿千折百',
    description: null,
    terms: null,
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
    staffCode: null,
    totalLimit: null,
    perContactLimit: 1,
    claimTagId: null,
    claimTagTtlDays: null,
    maskCodeBeforeStart: false,
    status: 'ACTIVE',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    issuedCount: 2000,
    claimedCount: 1200,
    redeemedCount: 400,
    ...over,
  };
}

const ACTIVE = coupon({ id: 'c-active', name: '秋季回饋 滿千折百', status: 'ACTIVE' });
const PAUSED = coupon({ id: 'c-paused', name: '門市週年慶 贈濾網', status: 'PAUSED', displayCode: 'MKT-ANNIV-GIFT' });
const DRAFT = coupon({
  id: 'c-draft',
  name: '中秋限定 空調 9 折',
  status: 'DRAFT',
  displayCode: 'MKT-MF26-90',
  issuedCount: 0,
  claimedCount: 0,
  redeemedCount: 0,
});
const ENDED = coupon({ id: 'c-ended', name: '舊機回收 兌換清潔服務', status: 'ENDED', displayCode: 'MKT-TRADEIN-SVC' });

const EMPTY_QUERY: CouponListQuery = { q: '', status: '', page: 1 };

function setList(list: unknown[]) {
  state.list = list;
  const counts = { ALL: list.length, ACTIVE: 0, PAUSED: 0, DRAFT: 0, ENDED: 0 } as Record<string, number>;
  for (const c of list as { status: string }[]) counts[c.status] += 1;
  state.statusCounts = counts as typeof state.statusCounts;
  state.total = list.length;
  state.allTotal = list.length;
}

function renderView(query: CouponListQuery = EMPTY_QUERY) {
  const onQueryChange = vi.fn();
  render(<CouponListView query={query} onQueryChange={onQueryChange} />);
  return { onQueryChange };
}

function openMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `${name} 的更多操作` }));
  return screen.getByRole('menu');
}

function menuLabels(menu: HTMLElement) {
  return within(menu)
    .getAllByRole('menuitem')
    .map((el) => el.getAttribute('data-label'));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.perms = new Set(['coupon.view', 'coupon.manage']);
  state.error = undefined;
  state.isLoading = false;
  setList([ACTIVE, PAUSED, DRAFT, ENDED]);
});

describe('操作選單依狀態不同', () => {
  test.each([
    ['進行中', ACTIVE.name, ['查看明細', '編輯', '暫停發放', '提前結束', '複製']],
    ['已暫停', PAUSED.name, ['查看明細', '恢復發放', '提前結束', '複製']],
    ['草稿', DRAFT.name, ['查看明細', '編輯', '複製', '刪除']],
    ['已結束', ENDED.name, ['查看明細', '複製']],
  ])('%s的券顯示對應的選單項目', (_status, name, expected) => {
    renderView();
    assert.deepEqual(menuLabels(openMenu(name)), expected);
  });

  test('提前結束與刪除為危險樣式（紅字）', () => {
    renderView();
    const menu = openMenu(ACTIVE.name);
    const end = within(menu).getByRole('menuitem', { name: /提前結束/ });
    assert.ok(end.className.includes('text-destructive'));
  });
});

describe('提前結束', () => {
  test('確認框列出已領取與尚未使用張數，確認後呼叫 endCoupon 並提示', async () => {
    coupons.endCoupon.mockResolvedValue({});
    renderView();
    fireEvent.click(within(openMenu(ACTIVE.name)).getByRole('menuitem', { name: /提前結束/ }));

    const dialog = screen.getByRole('alertdialog');
    assert.ok(within(dialog).getByText(`提前結束「${ACTIVE.name}」？`));
    assert.match(
      dialog.textContent ?? '',
      /已有 1,200 張被領取，其中 800 張尚未使用。結束後這些券將立即失效，也無法再發放。/,
    );

    fireEvent.click(within(dialog).getByRole('button', { name: '提前結束' }));
    await waitFor(() => assert.equal(coupons.endCoupon.mock.calls.length, 1));
    assert.equal(coupons.endCoupon.mock.calls[0][0], 'c-active');
    await screen.findByText(`已提前結束「${ACTIVE.name}」`);
    assert.ok(coupons.mutate.mock.calls.length >= 1);
  });

  test('失敗時顯示錯誤提示，不只寫 log', async () => {
    coupons.endCoupon.mockRejectedValue({ response: { data: { error: { message: '此優惠券已結束' } } } });
    renderView();
    fireEvent.click(within(openMenu(ACTIVE.name)).getByRole('menuitem', { name: /提前結束/ }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '提前結束' }));
    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent ?? '', /此優惠券已結束/);
  });
});

describe('不需確認的操作', () => {
  test('暫停發放直接呼叫 pauseCoupon 並提示', async () => {
    coupons.pauseCoupon.mockResolvedValue(undefined);
    renderView();
    fireEvent.click(within(openMenu(ACTIVE.name)).getByRole('menuitem', { name: /暫停發放/ }));
    await screen.findByText(`已暫停發放「${ACTIVE.name}」`);
    assert.equal(coupons.pauseCoupon.mock.calls[0][0], 'c-active');
    assert.ok(screen.queryByRole('alertdialog') === null);
  });

  test('恢復發放直接呼叫 resumeCoupon 並提示', async () => {
    coupons.resumeCoupon.mockResolvedValue(undefined);
    renderView();
    fireEvent.click(within(openMenu(PAUSED.name)).getByRole('menuitem', { name: /恢復發放/ }));
    await screen.findByText(`已恢復發放「${PAUSED.name}」`);
    assert.equal(coupons.resumeCoupon.mock.calls[0][0], 'c-paused');
  });

  test('複製後以新草稿的名稱提示', async () => {
    coupons.duplicateCoupon.mockResolvedValue({ ...ENDED, id: 'c-copy', name: `${ENDED.name}（複製）`, status: 'DRAFT' });
    renderView();
    fireEvent.click(within(openMenu(ENDED.name)).getByRole('menuitem', { name: /複製/ }));
    await screen.findByText(`已複製為草稿「${ENDED.name}（複製）」`);
    assert.equal(coupons.duplicateCoupon.mock.calls[0][0], 'c-ended');
  });
});

describe('從其他頁回到列表的提示', () => {
  test('儲存草稿後回到列表顯示提示，並通知頁面清掉網址參數', async () => {
    const onNoticeShown = vi.fn();
    render(
      <CouponListView query={EMPTY_QUERY} onQueryChange={vi.fn()} notice="已儲存草稿" onNoticeShown={onNoticeShown} />,
    );
    await screen.findByText('已儲存草稿');
    assert.equal(onNoticeShown.mock.calls.length, 1);
  });
});

describe('刪除草稿', () => {
  test('確認框顯示「刪除後無法復原。」，確認後呼叫 deleteCoupon', async () => {
    coupons.deleteCoupon.mockResolvedValue(undefined);
    renderView();
    fireEvent.click(within(openMenu(DRAFT.name)).getByRole('menuitem', { name: /刪除/ }));
    const dialog = screen.getByRole('alertdialog');
    assert.match(dialog.textContent ?? '', /刪除後無法復原。/);
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除' }));
    await screen.findByText(`已刪除「${DRAFT.name}」`);
    assert.equal(coupons.deleteCoupon.mock.calls[0][0], 'c-draft');
  });
});

describe('列點擊導向', () => {
  test('草稿進入編輯頁', () => {
    renderView();
    fireEvent.click(screen.getByText(DRAFT.name));
    assert.equal(router.push.mock.calls[0][0], '/dashboard/marketing/coupons/c-draft/edit');
  });

  test('其他狀態進入詳情，Enter 也可以開啟', () => {
    renderView();
    const row = screen.getByText(ACTIVE.name).closest('tr');
    assert.ok(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    assert.equal(router.push.mock.calls[0][0], '/dashboard/marketing/coupons/c-active');
  });

  test('點選單按鈕不會開啟該列', () => {
    renderView();
    openMenu(ACTIVE.name);
    assert.equal(router.push.mock.calls.length, 0);
  });
});

describe('列表內容', () => {
  test('核銷率顯示百分比與已核銷張數；沒有領取時顯示尚未發放', () => {
    renderView();
    const row = screen.getByText(ACTIVE.name).closest('tr') as HTMLElement;
    assert.match(row.textContent ?? '', /33\.3%/);
    assert.match(row.textContent ?? '', /400 張已核銷/);
    const draftRow = screen.getByText(DRAFT.name).closest('tr') as HTMLElement;
    assert.match(draftRow.textContent ?? '', /尚未發放/);
  });

  test('表尾在有篩選時標示全部張數', () => {
    state.list = [ACTIVE];
    state.total = 1;
    state.allTotal = 4;
    renderView({ q: '秋季', status: '', page: 1 });
    assert.ok(screen.getByText('共 1 張優惠券（已篩選，全部 4 張）'));
  });
});

describe('搜尋與篩選', () => {
  test('輸入搜尋字後（debounce）更新查詢', async () => {
    const { onQueryChange } = renderView();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋券名稱或券號' }), { target: { value: 'svc' } });
    await waitFor(() => assert.deepEqual(onQueryChange.mock.calls.at(-1)?.[0], { q: 'svc', status: '', page: 1 }));
  });

  test('點狀態分段更新查詢，並顯示各狀態張數', () => {
    const { onQueryChange } = renderView();
    const draftTab = screen.getByRole('button', { name: /草稿\s*1/ });
    fireEvent.click(draftTab);
    assert.deepEqual(onQueryChange.mock.calls.at(-1)?.[0], { q: '', status: 'DRAFT', page: 1 });
  });
});

describe('系統狀態', () => {
  test('沒有符合條件時顯示清除搜尋與篩選，按下後同時清空', () => {
    setList([]);
    state.allTotal = 4;
    const { onQueryChange } = renderView({ q: 'xyz', status: 'PAUSED', page: 1 });
    assert.ok(screen.getByText('沒有符合條件的優惠券'));
    fireEvent.click(screen.getByRole('button', { name: '清除搜尋與篩選' }));
    assert.deepEqual(onQueryChange.mock.calls.at(-1)?.[0], { q: '', status: '', page: 1 });
  });

  test('沒有任何優惠券時顯示建立的引導', () => {
    setList([]);
    renderView();
    assert.ok(screen.getByText('還沒有優惠券'));
    assert.ok(screen.queryByText('沒有符合條件的優惠券') === null);
  });

  test('載入失敗顯示原因與重試，按下重試重新載入', () => {
    state.list = [];
    state.error = new Error('timeout');
    renderView();
    assert.ok(screen.getByText('優惠券列表載入失敗'));
    assert.ok(screen.getByText('網路連線逾時，請確認網路後重試。'));
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    assert.ok(coupons.mutate.mock.calls.length >= 1);
  });

  test('載入中顯示骨架', () => {
    state.list = [];
    state.isLoading = true;
    renderView();
    assert.ok(screen.getByLabelText('載入中'));
  });

  test('無查看權限時顯示全頁說明，不顯示列表', () => {
    auth.perms = new Set();
    renderView();
    assert.ok(screen.getByText('你沒有查看此頁面的權限，請洽主管'));
    assert.ok(screen.queryByText(ACTIVE.name) === null);
  });

  test('無編輯權限時建立按鈕停用，編輯類操作停用，查看明細仍可用', () => {
    auth.perms = new Set(['coupon.view']);
    renderView();
    const create = screen.getByRole('button', { name: /建立優惠券/ });
    assert.equal((create as HTMLButtonElement).disabled, true);
    assert.ok(screen.getAllByText('需主管權限').length >= 1);

    const menu = openMenu(ACTIVE.name);
    const view = within(menu).getByRole('menuitem', { name: /查看明細/ });
    assert.ok(view.getAttribute('aria-disabled') !== 'true');
    for (const label of ['編輯', '暫停發放', '提前結束', '複製']) {
      const item = within(menu).getByRole('menuitem', { name: new RegExp(label) });
      assert.equal(item.getAttribute('aria-disabled'), 'true', label);
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: /暫停發放/ }));
    assert.equal(coupons.pauseCoupon.mock.calls.length, 0);
  });
});
