// @vitest-environment jsdom
/**
 * 券詳情頁「領券連結」分頁（add-coupon-system A15 15.32；design D30）。
 * spec coupon-management「管理者可建立公開領券連結」。替換資料 hook，只測畫面行為。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => {
  const mutate = vi.fn();
  return {
    mutate,
    links: [] as unknown[],
    channels: [] as unknown[],
    createClaimLink: vi.fn(),
    setClaimLinkStatus: vi.fn(),
    downloadClaimLinkQr: vi.fn(),
  };
});

vi.mock('#src/hooks/useCouponClaimLinks.js', () => ({
  useCouponClaimLinks: () => ({ links: h.links, error: undefined, isLoading: false, mutate: h.mutate }),
  createClaimLink: h.createClaimLink,
  setClaimLinkStatus: h.setClaimLinkStatus,
  downloadClaimLinkQr: h.downloadClaimLinkQr,
}));
vi.mock('#src/hooks/useChannels.js', () => ({
  useChannels: () => ({ channels: h.channels, isLoading: false, error: undefined, mutate: vi.fn() }),
}));

import { CouponClaimLinksPanel } from '#src/components/coupons/detail/CouponClaimLinksPanel.js';
import type { Coupon } from '#src/hooks/useCoupons.js';

const COUPON_ID = '11111111-1111-4111-8111-111111111111';
const LINE_ID = '22222222-2222-4222-8222-222222222222';

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return { id: COUPON_ID, name: '秋季九折', purpose: 'MARKETING', status: 'ACTIVE', ...overrides } as Coupon;
}

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    couponId: COUPON_ID,
    name: '門市海報',
    code: 'K7M2Q9XA',
    status: 'ACTIVE',
    startAt: null,
    endAt: null,
    openCount: 128,
    claimCount: 37,
    createdAt: '2026-10-22T00:00:00.000Z',
    url: 'https://crm.example.com/coupon/claim/K7M2Q9XA',
    channel: { id: LINE_ID, channelType: 'LINE', displayName: '總店 LINE', ready: true },
    ...overrides,
  };
}

const showOk = vi.fn();
const showError = vi.fn();

function renderPanel(props: Partial<{ coupon: Coupon; canManage: boolean }> = {}) {
  return render(
    <CouponClaimLinksPanel coupon={props.coupon ?? coupon()} canManage={props.canManage ?? true} showOk={showOk} showError={showError} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.links = [link()];
  h.channels = [
    { id: LINE_ID, channelType: 'LINE', displayName: '總店 LINE', isActive: true },
    { id: 'web', channelType: 'WEBCHAT', displayName: '官網客服', isActive: true },
  ];
});

describe('管理者可建立公開領券連結', () => {
  test('建立領券連結', async () => {
    h.createClaimLink.mockResolvedValue({ ...link({ id: 'l2', name: '官網橫幅' }), qrCode: 'data:image/png;base64,AAAA' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '建立領券連結' }));
    const dialog = screen.getByRole('alertdialog', { name: '建立領券連結' });
    fireEvent.change(within(dialog).getByLabelText('連結名稱'), { target: { value: '官網橫幅' } });
    // 只列出 LINE、Facebook、Instagram 渠道
    const select = within(dialog).getByLabelText('領券的渠道') as HTMLSelectElement;
    assert.deepEqual([...select.options].map((o) => o.textContent), ['請選擇渠道', '總店 LINE（LINE）']);
    fireEvent.change(select, { target: { value: LINE_ID } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
    });
    assert.deepEqual(h.createClaimLink.mock.calls[0], [COUPON_ID, { name: '官網橫幅', channelId: LINE_ID, startAt: null, endAt: null }]);
    assert.equal(showOk.mock.calls[0]?.[0], '已建立領券連結');
    assert.ok(h.mutate.mock.calls.length > 0, '重新載入清單');
  });

  test('建立失敗時顯示原因', async () => {
    h.createClaimLink.mockRejectedValue({ response: { data: { error: { message: '找不到這個渠道，請重新選擇' } } } });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '建立領券連結' }));
    const dialog = screen.getByRole('alertdialog', { name: '建立領券連結' });
    fireEvent.change(within(dialog).getByLabelText('連結名稱'), { target: { value: '官網橫幅' } });
    fireEvent.change(within(dialog).getByLabelText('領券的渠道'), { target: { value: LINE_ID } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
    });
    assert.ok(within(dialog).getByRole('alert').textContent?.includes('找不到這個渠道'));
  });

  test('沒填名稱或渠道不能送出', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '建立領券連結' }));
    const dialog = screen.getByRole('alertdialog', { name: '建立領券連結' });
    fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
    assert.equal(h.createClaimLink.mock.calls.length, 0);
    assert.ok(within(dialog).getByText('請輸入連結名稱'));
  });

  test('客服補償券不能建立領券連結', () => {
    h.links = [];
    renderPanel({ coupon: coupon({ purpose: 'SERVICE' }) });
    assert.ok(screen.getByText(/客服補償券不能建立領券連結/));
    assert.ok(screen.queryByRole('button', { name: '建立領券連結' }) === null);
  });

  test('缺少管理權限時只能查看', () => {
    renderPanel({ canManage: false });
    assert.ok(screen.getByText('門市海報'));
    assert.ok(screen.queryByRole('button', { name: '建立領券連結' }) === null);
    assert.ok(screen.queryByRole('button', { name: '停用' }) === null);
  });
});

describe('領券連結清單', () => {
  test('顯示網址、開啟數與領取數', () => {
    renderPanel();
    const row = screen.getByRole('listitem', { name: '門市海報' });
    assert.ok(within(row).getByText('https://crm.example.com/coupon/claim/K7M2Q9XA'));
    assert.ok(within(row).getByText('128'));
    assert.ok(within(row).getByText('37'));
    assert.ok(within(row).getByText('總店 LINE'));
  });

  test('停用與重新啟用', async () => {
    h.setClaimLinkStatus.mockResolvedValue(link({ status: 'DISABLED' }));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停用' }));
    });
    assert.deepEqual(h.setClaimLinkStatus.mock.calls[0], [COUPON_ID, 'l1', 'DISABLED']);
    assert.equal(showOk.mock.calls[0]?.[0], '已停用領券連結');

    cleanup();
    h.links = [link({ status: 'DISABLED' })];
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重新啟用' }));
    });
    assert.deepEqual(h.setClaimLinkStatus.mock.calls[1], [COUPON_ID, 'l1', 'ACTIVE']);
  });

  test('下載 QR Code', async () => {
    h.downloadClaimLinkQr.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const createObjectURL = vi.fn(() => 'blob:qr');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下載 QR Code' }));
    });
    assert.deepEqual(h.downloadClaimLinkQr.mock.calls[0], [COUPON_ID, 'l1']);
    assert.equal(createObjectURL.mock.calls.length, 1);
  });

  test('下載失敗時告知原因', async () => {
    h.downloadClaimLinkQr.mockRejectedValue(new Error('network'));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下載 QR Code' }));
    });
    assert.ok(String(showError.mock.calls[0]?.[0]).length > 0);
  });

  test('渠道沒有公開帳號時提示顧客開不了對話', () => {
    h.links = [link({ channel: { id: LINE_ID, channelType: 'LINE', displayName: '總店 LINE', ready: false } })];
    renderPanel();
    assert.ok(screen.getByText(/顧客無法開啟對話/));
  });
});
