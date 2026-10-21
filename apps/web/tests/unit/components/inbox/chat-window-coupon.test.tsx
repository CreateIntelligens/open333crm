// @vitest-environment jsdom
/**
 * 對話發券在收件匣的入口與結果（add-coupon-system A11；CM-196「對話發券 UX 規格」）：
 * 輸入區「發券」按鈕、對話關閉時停用、發送成功提示、草稿不受影響、對話中的券卡、右側已發優惠券。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: null }) }));

import { ChatWindow } from '#src/components/inbox/ChatWindow.js';
import { IssuedCouponsSection } from '#src/components/inbox/coupon/IssuedCouponsSection.js';

const conversation = {
  id: 'c0000000-0000-4000-8000-000000000001',
  channelType: 'LINE',
  status: 'ACTIVE',
  assignedToId: null,
  contact: { id: 'contact-1', name: '林佩君' },
};

const context = {
  conversation: { id: conversation.id, status: 'ACTIVE', assignedToId: null, contactId: 'contact-1', contactName: '林佩君', channelType: 'LINE' },
  blocked: null,
  history: { count: 0, totalAmount: 0, latest: null },
  coupons: [{
    id: 'k1', name: '小額致歉金', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, discountPercent: null, percentCap: null,
    giftName: null, giftQty: null, exchangeItem: null, minSpend: null, validityMode: 'AFTER_CLAIM', startAt: null, endAt: null,
    afterClaimDays: 30, afterOpenMinutes: null, perContactLimit: 2, receivedCount: 0, limitReached: false,
    lastClaimedAt: null, lastRedeemedAt: null, expiringAt: null, drivesSpend: false,
  }],
};

let messages: unknown[] = [];

// jsdom 沒有 scrollIntoView；有訊息時 ChatWindow 會捲到最下方
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

beforeEach(() => {
  messages = [];
  api.get.mockReset().mockImplementation((url: string) => {
    if (url.startsWith('/coupon-issue/conversations/')) return Promise.resolve({ data: { success: true, data: context } });
    if (url.includes('/messages')) return Promise.resolve({ data: { data: messages, meta: {} } });
    return Promise.resolve({ data: { data: [], meta: {} } });
  });
  api.post.mockReset();
  api.patch.mockReset();
});

const flush = () => act(async () => {});
/** 每個測試用新的 SWR 快取，避免沿用上一個測試的資料 */
const renderChat = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
const renderSection = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <IssuedCouponsSection conversationId={conversation.id} />
    </SWRConfig>,
  );
const toolbarButtons = () =>
  screen.getAllByRole('button').filter((b) => ['附件', '模板', '發券'].includes(b.getAttribute('title') ?? b.textContent?.trim() ?? ''));

describe('入口', () => {
  test('發券按鈕在附件、範本之後，使用文字「發券」', async () => {
    renderChat(<ChatWindow conversation={conversation} canIssueCoupon />);
    await flush();
    const names = toolbarButtons().map((b) => b.getAttribute('title') ?? b.textContent?.trim());
    assert.deepEqual(names, ['附件', '模板', '發券']);
    assert.ok(screen.getByRole('button', { name: '發券' }));
  });

  test('沒有發券權限時不顯示按鈕', async () => {
    renderChat(<ChatWindow conversation={conversation} />);
    await flush();
    assert.ok(screen.queryByRole('button', { name: '發券' }) === null);
  });

  test('對話已關閉時按鈕停用，滑過或聚焦時說明原因', async () => {
    renderChat(<ChatWindow conversation={{ ...conversation, status: 'CLOSED' }} canIssueCoupon />);
    await flush();
    const btn = screen.getByRole('button', { name: '發券' });
    assert.equal(btn.getAttribute('aria-disabled'), 'true');
    assert.ok(screen.getByText('對話已結束，無法發券'));
    fireEvent.click(btn);
    await flush();
    assert.ok(screen.queryByRole('heading', { name: /發券給/ }) === null);
  });
});

describe('發送成功', () => {
  test('Dialog 關閉、底部提示面額，輸入框草稿保留', async () => {
    api.post.mockResolvedValue({ data: { success: true, data: { instanceId: 'i1', code: 'X', couponId: 'k1', couponName: '小額致歉金', messageId: 'm1' } } });
    renderChat(<ChatWindow conversation={conversation} canIssueCoupon />);
    await flush();
    const textarea = document.querySelector('textarea[data-message-input]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '稍等我幫您處理' } });

    fireEvent.click(screen.getByRole('button', { name: '發券' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '選擇' }));
    fireEvent.click(screen.getByRole('button', { name: '確認發送' }));
    await flush();

    assert.ok(screen.queryByRole('heading', { name: /發券給/ }) === null);
    assert.equal(screen.getByRole('status').textContent, '已發送 NT$100 補償券');
    assert.equal(textarea.value, '稍等我幫您處理');
  });
});

describe('對話中的券卡', () => {
  test('顯示券名、面額、有效期、查看優惠券與發送人', async () => {
    messages = [{
      id: 'm1', direction: 'OUTBOUND', senderType: 'AGENT', contentType: 'text', createdAt: '2026-10-21T07:19:00.000Z',
      content: {
        text: '為您準備了一張優惠券：滿千折百 補償券\n\n點擊以下連結查看：\nhttps://crm.example.com/coupon/open/abc',
        coupon: {
          instanceId: 'i1', couponId: 'k9', name: '滿千折百 補償券', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100,
          discountPercent: null, giftName: null, exchangeItem: null, minSpend: 1000,
          expiresAt: '2026-11-19T15:59:59.000Z', issuedByName: '小林',
        },
      },
    }];
    renderChat(<ChatWindow conversation={conversation} canIssueCoupon />);
    await flush();
    const card = screen.getByRole('article', { name: '優惠券訊息' });
    assert.ok(within(card).getByText('NT$100'));
    assert.ok(within(card).getByText('滿千折百 補償券'));
    assert.ok(within(card).getByText('有效期至 2026/11/19'));
    const link = within(card).getByRole('link', { name: '查看優惠券' }) as HTMLAnchorElement;
    assert.equal(link.getAttribute('href'), '/dashboard/marketing/coupons/k9');
    assert.match(screen.getByText(/^由 小林 發送 · \d{2}:\d{2}$/).textContent ?? '', /由 小林 發送/);
    // 連結是給顧客的，後台不顯示原文
    assert.ok(screen.queryByText(/coupon\/open\/abc/) === null);
  });
});

describe('右側已發優惠券', () => {
  test('列出券名、面額、發送人、時間與狀態', async () => {
    api.get.mockImplementation(() => Promise.resolve({
      data: {
        success: true,
        data: [
          { id: 'i2', couponId: 'k1', couponName: '滿千折百 補償券', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, discountPercent: null, giftName: null, exchangeItem: null, issuedByName: '小林', issuedSourceName: '對話發券', issuedAt: '2026-10-21T07:19:00.000Z', status: 'SENT' },
          { id: 'i1', couponId: 'k2', couponName: '小額致歉金', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, discountPercent: null, giftName: null, exchangeItem: null, issuedByName: '阿哲', issuedSourceName: '對話發券', issuedAt: '2026-10-21T01:40:00.000Z', status: 'VIEWED' },
        ],
      },
    }));
    renderSection();
    await flush();
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 2);
    assert.ok(within(items[0]).getByText('滿千折百 補償券'));
    assert.ok(within(items[0]).getByText('NT$100'));
    assert.ok(within(items[0]).getByText(/^小林 · \d{2}\/\d{2} \d{2}:\d{2}$/));
    assert.ok(within(items[0]).getByText('已發送'));
    assert.ok(within(items[1]).getByText('已領取'));
    assert.ok(screen.getByText('2'), '標題旁顯示張數');
  });

  test('沒有券', async () => {
    api.get.mockImplementation(() => Promise.resolve({ data: { success: true, data: [] } }));
    renderSection();
    await flush();
    assert.ok(screen.getByText('尚未發過優惠券'));
  });

  test('載入失敗顯示原因並可重試', async () => {
    api.get.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: { error: { message: '伺服器錯誤' } } } }));
    renderSection();
    await flush();
    assert.ok(screen.getByRole('alert'));
    api.get.mockImplementation(() => Promise.resolve({ data: { success: true, data: [] } }));
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await flush();
    assert.ok(screen.getByText('尚未發過優惠券'));
  });
});
