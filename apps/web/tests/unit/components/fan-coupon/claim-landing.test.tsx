// @vitest-environment jsdom
/**
 * 公開領券頁（/coupon/claim/{代碼}；add-coupon-system A15 15.32、design D30）。
 * spec coupon-management「公開領券頁引導顧客傳送領券訊息」。替換資料讀取，只測畫面行為。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ fetchPublicClaim: vi.fn() }));
vi.mock('#src/lib/fan-coupon/claim.js', () => ({ fetchPublicClaim: mocks.fetchPublicClaim }));

import { ClaimLanding } from '#src/components/fan-coupon/claim/ClaimLanding.js';

const COUPON = {
  name: '秋季九折',
  description: null,
  imageUrl: null,
  couponType: 'DISCOUNT_PERCENT',
  discountAmount: null,
  discountPercent: 10,
  percentCap: 300,
  minSpend: null,
  giftName: null,
  giftQty: null,
  exchangeItem: null,
  validityMode: 'AFTER_CLAIM',
  startAt: null,
  endAt: null,
  afterClaimDays: 30,
  afterOpenMinutes: null,
};

const LINE = {
  channelType: 'LINE',
  publicName: '@shop123',
  addFriendUrl: 'https://line.me/R/ti/p/%40shop123',
  sendCodeUrl: 'https://line.me/R/oaMessage/%40shop123/?%E6%88%91%E8%A6%81K7M2Q9XA',
};

async function renderLanding() {
  await act(async () => {
    render(<ClaimLanding code="K7M2Q9XA" />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('公開領券頁引導顧客傳送領券訊息', () => {
  test('開啟有效的領券頁', async () => {
    mocks.fetchPublicClaim.mockResolvedValue({ available: true, message: null, coupon: COUPON, channel: LINE });
    await renderLanding();
    assert.equal(mocks.fetchPublicClaim.mock.calls[0]?.[0], 'K7M2Q9XA');
    assert.ok(screen.getByText('秋季九折'));
    assert.ok(screen.getByText('領取後 30 天內有效'));
    const addFriend = screen.getByRole('link', { name: /加入好友/ });
    assert.equal(addFriend.getAttribute('href'), LINE.addFriendUrl);
    const send = screen.getByRole('link', { name: /傳送領券訊息/ });
    assert.equal(send.getAttribute('href'), LINE.sendCodeUrl);
  });

  test('Instagram 渠道顯示開啟對話的按鈕', async () => {
    mocks.fetchPublicClaim.mockResolvedValue({
      available: true, message: null, coupon: COUPON,
      channel: { channelType: 'THREADS', publicName: '@shop.ig', sendCodeUrl: 'https://ig.me/m/shop.ig?ref=coupon_K7M2Q9XA' },
    });
    await renderLanding();
    const open = screen.getByRole('link', { name: /Instagram/ });
    assert.equal(open.getAttribute('href'), 'https://ig.me/m/shop.ig?ref=coupon_K7M2Q9XA');
    assert.ok(screen.queryByRole('link', { name: /加入好友/ }) === null);
  });

  test('已停用的連結', async () => {
    mocks.fetchPublicClaim.mockResolvedValue({ available: false, message: '這個領券活動目前無法領取', coupon: COUPON, channel: null });
    await renderLanding();
    assert.ok(screen.getByText('這個領券活動目前無法領取'));
    assert.ok(screen.queryByRole('link') === null, '沒有領券按鈕');
  });

  test('不存在的代碼', async () => {
    mocks.fetchPublicClaim.mockRejectedValue({ response: { status: 404 } });
    await renderLanding();
    assert.ok(screen.getByText('找不到這個領券活動'));
    assert.ok(screen.queryByText('秋季九折') === null);
    assert.ok(screen.queryByRole('link') === null);
  });

  test('載入失敗時可以重試', async () => {
    mocks.fetchPublicClaim.mockRejectedValueOnce(new Error('Network Error'));
    await renderLanding();
    assert.ok(screen.getByRole('alert'));
    mocks.fetchPublicClaim.mockResolvedValue({ available: true, message: null, coupon: COUPON, channel: LINE });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重試' }));
    });
    assert.ok(screen.getByText('秋季九折'));
  });
});
