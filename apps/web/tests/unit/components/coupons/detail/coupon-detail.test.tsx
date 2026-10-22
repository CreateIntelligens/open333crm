// @vitest-environment jsdom
/**
 * 優惠券詳情頁（UX 規則第 4、5 節；Jira CM-196「詳情頁返回、序號明細」「整體系統狀態」）。
 * 替換資料 hook、登入者權限與 next/navigation，只測畫面行為。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => {
  const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
  const mutate = vi.fn();
  return {
    router,
    mutate,
    search: new URLSearchParams(),
    perms: ['coupon.view', 'coupon.manage'] as string[],
    coupon: { coupon: null as unknown, error: undefined as unknown, isLoading: false, mutate },
    stats: { stats: null as unknown, error: undefined as unknown, isLoading: false, mutate },
    instances: {
      instances: [] as unknown[],
      meta: { total: 0, page: 1, limit: 50 } as { total: number; page: number; limit: number } | undefined,
      error: undefined as unknown,
      isLoading: false,
      mutate,
    },
    lastQuery: null as unknown,
  };
});

vi.mock('#src/hooks/useCoupons.js', () => ({
  useCoupon: () => h.coupon,
  useCouponStats: () => h.stats,
  useCouponInstances: (_id: string, query: unknown) => {
    h.lastQuery = query;
    return h.instances;
  },
  downloadInstancesCsv: vi.fn(),
  downloadExportFile: vi.fn(),
}));
vi.mock('#src/hooks/useContactTags.js', () => ({
  useContactTags: () => ({ tags: [{ id: 't1', name: '秋季檔期意向', color: '#000', scope: 'CONTACT' }], isLoading: false }),
}));
vi.mock('#src/providers/AuthProvider.js', () => {
  const hasPermission = (code: string) => h.perms.includes(code);
  return { useAuth: () => ({ isLoading: false, hasPermission }) };
});
vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  useSearchParams: () => h.search,
  usePathname: () => '/dashboard/marketing/coupons/c1',
}));

import { CouponDetailView } from '#src/components/coupons/detail/CouponDetailView.js';
import * as couponHooks from '#src/hooks/useCoupons.js';

const ID = '11111111-1111-4111-8111-111111111111';

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    displayCode: 'MKT-AUTUMN-100',
    name: '秋季回饋 滿千折百',
    description: null,
    terms: '限直營門市使用\n不得與其他優惠併用',
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
    validityMode: 'FIXED',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-10-31T00:00:00.000Z',
    afterClaimDays: null,
    afterOpenMinutes: null,
    codeMode: 'UNIQUE_CODE',
    sharedCode: null,
    codePrefix: 'AUTUMN',
    redeemMode: 'STAFF_CODE',
    staffCode: '837426',
    totalLimit: 20000,
    perContactLimit: 1,
    claimTagId: 't1',
    claimTagTtlDays: 30,
    maskCodeBeforeStart: true,
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    code: 'AUTUMN-XKM4-QDEJ',
    status: 'CLAIMED',
    issuedAt: '2026-10-03T08:30:00.000Z',
    claimedAt: '2026-10-04T08:19:00.000Z',
    openedAt: null,
    redeemedAt: null,
    issuedVia: 'campaign',
    issuedSourceName: null,
    issuedByName: null,
    redeemChannel: null,
    contact: { id: 'ct1', displayName: '蔡怡君' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.search = new URLSearchParams();
  h.perms = ['coupon.view', 'coupon.manage'];
  h.coupon = { coupon: coupon(), error: undefined, isLoading: false, mutate: h.mutate };
  h.stats = {
    stats: { issued: 200, claimed: 50, opened: 20, redeemed: 10, linkOpened: 80, claimRate: 25, redeemRate: 20 },
    error: undefined,
    isLoading: false,
    mutate: h.mutate,
  };
  h.instances = { instances: [row()], meta: { total: 1, page: 1, limit: 50 }, error: undefined, isLoading: false, mutate: h.mutate };
});

function statCard(label: string) {
  return screen.getByRole('group', { name: label });
}

describe('六個指標卡', () => {
  test('領取率＝領取÷發送、開封率＝開封÷領取、核銷率＝核銷÷領取', () => {
    render(<CouponDetailView id={ID} />);
    assert.ok(within(statCard('發送')).getByText('200'));
    assert.ok(within(statCard('領取')).getByText('領取率 25.0%'));
    assert.ok(within(statCard('開封')).getByText('開封率 40.0%'));
    assert.ok(within(statCard('核銷')).getByText('已在門市使用'));
    assert.ok(within(statCard('核銷率')).getByText('20.0%'));
    assert.ok(within(statCard('核銷率')).getByText('核銷 ÷ 領取'));
  });

  test('開啟連結：顯示張數與點擊率（開啟連結 ÷ 發送）', () => {
    render(<CouponDetailView id={ID} />);
    assert.ok(within(statCard('開啟連結')).getByText('80'));
    assert.ok(within(statCard('開啟連結')).getByText('點擊率 40.0%'));
  });

  test('分母為 0 時百分比顯示 0.0%', () => {
    h.stats.stats = { issued: 0, claimed: 0, opened: 0, redeemed: 0, linkOpened: 0, claimRate: null, redeemRate: null };
    render(<CouponDetailView id={ID} />);
    assert.ok(within(statCard('領取')).getByText('領取率 0.0%'));
    assert.ok(within(statCard('開封')).getByText('開封率 0.0%'));
    assert.ok(within(statCard('核銷率')).getByText('0.0%'));
  });
});

describe('序號明細依序號模式調整', () => {
  test('一人一碼顯示序號欄，搜尋 label 為「序號或顧客名稱」', () => {
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByRole('columnheader', { name: '序號' }));
    assert.ok(screen.getByLabelText('序號或顧客名稱'));
  });

  test('共用碼不顯示序號欄，上方顯示共用券號，搜尋 label 為「顧客名稱」', () => {
    h.coupon.coupon = coupon({ codeMode: 'SHARED_CODE', sharedCode: 'ANNIV2026', codePrefix: null });
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.queryByRole('columnheader', { name: '序號' }) === null);
    assert.ok(screen.getByRole('columnheader', { name: '顧客名稱' }));
    assert.ok(screen.getByText('ANNIV2026'));
    assert.ok(screen.getByText('所有顧客使用同一組券號，下方列出領取與使用紀錄'));
    assert.ok(screen.getByLabelText('顧客名稱'));
  });
});

describe('序號明細的空狀態', () => {
  test('沒有任何篩選且總數為 0：顯示「尚未發放任何序號」，不顯示清除篩選', () => {
    h.instances.instances = [];
    h.instances.meta = { total: 0, page: 1, limit: 50 };
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByText('尚未發放任何序號'));
    assert.ok(screen.queryByText('沒有符合條件的序號') === null);
    assert.ok(screen.queryByRole('button', { name: '清除篩選' }) === null);
  });

  test('有篩選且結果為 0：顯示「沒有符合條件的序號」與「清除篩選」', () => {
    h.instances.instances = [];
    h.instances.meta = { total: 0, page: 1, limit: 50 };
    render(<CouponDetailView id={ID} />);
    fireEvent.change(screen.getByLabelText('狀態'), { target: { value: 'REDEEMED' } });
    assert.ok(screen.getByText('沒有符合條件的序號'));
    assert.ok(screen.getByText('請確認顧客提供的券號，或調整搜尋與篩選條件'));
    assert.ok(screen.queryByText('尚未發放任何序號') === null);
    assert.equal((h.lastQuery as { status?: string }).status, 'REDEEMED');

    fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
    assert.equal((h.lastQuery as { status?: string }).status, undefined);
  });
});

describe('發放來源', () => {
  test('有快照時顯示兩行：上行來源名稱、下行發放人', () => {
    h.instances.instances = [row({ issuedVia: 'inbox', issuedSourceName: '對話發券', issuedByName: '王小美' })];
    render(<CouponDetailView id={ID} />);
    const cell = screen.getByText('對話發券').closest('td');
    assert.ok(cell);
    assert.ok(within(cell).getByText('王小美'));
  });

  test('沒有快照時用發放方式的文字，不留空白', () => {
    h.instances.instances = [row({ issuedVia: 'broadcast', issuedSourceName: null, issuedByName: null })];
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByText('廣播'));
  });
});

describe('設定分頁的驗證碼', () => {
  test('預設遮蔽，按「顯示」後出現原碼', () => {
    h.search = new URLSearchParams('tab=settings');
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByText('●●●●●●'));
    assert.ok(screen.queryByText('837426') === null);

    const toggle = screen.getByRole('button', { name: '顯示' });
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    fireEvent.click(toggle);
    assert.ok(screen.getByText('837426'));
    assert.equal(screen.getByRole('button', { name: '隱藏' }).getAttribute('aria-pressed'), 'true');
  });

  test('效期為領取後 N 天時，「未到生效日不顯示序號」寫明不適用的原因', () => {
    h.search = new URLSearchParams('tab=settings');
    h.coupon.coupon = coupon({ validityMode: 'AFTER_CLAIM', afterClaimDays: 30, startAt: null, endAt: null });
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByText('不適用（效期為領取後 30 天）'));
  });
});

describe('系統狀態', () => {
  test('優惠券不存在：顯示「找不到此優惠券」且不顯示任何券資料', () => {
    h.coupon = {
      coupon: null,
      error: { response: { status: 404, data: { error: { code: 'NOT_FOUND', message: '查無此券' } } } },
      isLoading: false,
      mutate: h.mutate,
    };
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByText('找不到此優惠券'));
    assert.ok(screen.getByRole('button', { name: '返回優惠券列表' }));
    assert.ok(screen.queryByText('秋季回饋 滿千折百') === null);
    assert.ok(screen.queryByText('AUTUMN-XKM4-QDEJ') === null);
    assert.ok(screen.queryByRole('group', { name: '發送' }) === null);
  });

  test('沒有 coupon.view 權限：全頁說明並提供返回', () => {
    h.perms = [];
    render(<CouponDetailView id={ID} />);
    assert.ok(screen.getByText('你沒有查看此頁面的權限，請洽主管'));
    assert.ok(screen.queryByText('秋季回饋 滿千折百') === null);
  });

  test('沒有 coupon.manage 權限：編輯停用並說明「需主管權限」', () => {
    h.perms = ['coupon.view'];
    render(<CouponDetailView id={ID} />);
    const edit = screen.getByRole('button', { name: /編輯/ });
    assert.equal(edit.getAttribute('aria-disabled'), 'true');
    assert.ok(screen.getByText('需主管權限'));
  });

  test('網址帶 published=1：顯示「已發布優惠券」並清掉 query', async () => {
    h.search = new URLSearchParams('published=1');
    await act(async () => {
      render(<CouponDetailView id={ID} />);
    });
    assert.ok(screen.getByText('已發布優惠券'));
    assert.equal(h.router.replace.mock.calls.length > 0, true);
    assert.ok(!String(h.router.replace.mock.calls.at(-1)?.[0]).includes('published'));
  });
});

describe('序號歷程側欄', () => {
  test('點列開啟歷程，未發生的步驟顯示「尚未開啟」「尚未核銷」；Esc 關閉', () => {
    render(<CouponDetailView id={ID} />);
    fireEvent.click(screen.getByText('蔡怡君'));
    const dialog = screen.getByRole('dialog');
    assert.ok(within(dialog).getByText('尚未開啟'));
    assert.ok(within(dialog).getByText('尚未核銷'));
    assert.ok(within(dialog).getByText('顧客 蔡怡君'));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    assert.ok(screen.queryByRole('dialog') === null);
  });
});

describe('分頁', () => {
  test('方向鍵切換分頁並同步到 ?tab=', () => {
    render(<CouponDetailView id={ID} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: '序號明細' }), { key: 'ArrowRight' });
    assert.equal(screen.getByRole('tab', { name: '設定' }).getAttribute('aria-selected'), 'true');
    assert.ok(String(h.router.replace.mock.calls.at(-1)?.[0]).includes('tab=settings'));
  });
});

describe('大量序號明細改背景匯出（design D22）', () => {
  const download = () => vi.mocked(couponHooks.downloadInstancesCsv);
  const exportFile = () => vi.mocked(couponHooks.downloadExportFile);
  URL.createObjectURL ??= () => 'blob:x';
  URL.revokeObjectURL ??= () => {};

  test('明細超過 5,000 筆：提示產生完成後會通知', async () => {
    download().mockResolvedValueOnce({ kind: 'background' } as never);
    render(<CouponDetailView id={ID} />);
    fireEvent.click(screen.getByRole('button', { name: '匯出 CSV' }));
    assert.ok(await screen.findByText('名單較多，產生完成後會通知你下載'));
  });

  test('從通知開啟：自動下載並清掉網址參數', async () => {
    h.search = new URLSearchParams('export=JOB123');
    exportFile().mockResolvedValueOnce({ blob: new Blob(['x']), fileName: '秋季回饋.csv' } as never);
    render(<CouponDetailView id={ID} />);
    await act(async () => {});
    assert.deepEqual(exportFile().mock.calls[0], ['JOB123']);
    assert.ok(await screen.findByText('已下載序號明細'));
    assert.ok(h.router.replace.mock.calls.some(([url]) => !String(url).includes('export=')));
  });

  test('從通知開啟但檔案已過期：顯示原因', async () => {
    h.search = new URLSearchParams('export=OLD');
    exportFile().mockRejectedValueOnce(
      Object.assign(new Error('410'), { response: { status: 410, data: { success: false, error: { code: 'EXPORT_EXPIRED', message: '匯出檔已過期，請回到優惠券頁重新匯出' } } } }),
    );
    render(<CouponDetailView id={ID} />);
    assert.ok(await screen.findByText(/匯出檔已過期/));
  });
});

