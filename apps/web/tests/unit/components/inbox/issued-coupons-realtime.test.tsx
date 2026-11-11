// @vitest-environment jsdom
/**
 * 「已發優惠券」區塊即時更新（add-coupon-system design D23；spec「右側區塊收到事件後重新載入」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (data: unknown) => void>();
  const socket = {
    on: (event: string, fn: (data: unknown) => void) => handlers.set(event, fn),
    off: (event: string) => handlers.delete(event),
  };
  return { handlers, socket, get: vi.fn() };
});
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get } }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: h.socket }) }));

import { IssuedCouponsSection } from '#src/components/inbox/coupon/IssuedCouponsSection.js';

const ROW = {
  id: 'inst-1', couponId: 'k1', couponName: '小額致歉金', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, discountPercent: null,
  giftName: null, exchangeItem: null, issuedByName: '小林', issuedSourceName: '對話發券', issuedAt: '2026-10-21T07:19:00.000Z', status: 'SENT',
};

beforeEach(() => {
  h.handlers.clear();
  h.get.mockReset().mockResolvedValue({ data: { success: true, data: [ROW] } });
});

const flush = () => act(async () => {});
const fire = (data: unknown) => act(async () => h.handlers.get('coupon.instance.updated')?.(data));

function renderSection() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <IssuedCouponsSection conversationId="conv-1" contactId="contact-1" />
    </SWRConfig>,
  );
}

test('收到這位聯絡人的事件：重新載入', async () => {
  renderSection();
  await flush();
  assert.ok(screen.getByText('小額致歉金'));
  const before = h.get.mock.calls.length;
  await fire({ instanceId: 'inst-9', contactId: 'contact-1', change: 'issued' });
  assert.equal(h.get.mock.calls.length, before + 1);
});

test('收到已列出的券的事件（例如門市核銷）：重新載入', async () => {
  renderSection();
  await flush();
  const before = h.get.mock.calls.length;
  await fire({ instanceId: 'inst-1', contactId: null, change: 'redeemed' });
  assert.equal(h.get.mock.calls.length, before + 1);
});

test('其他聯絡人的事件：不重新載入', async () => {
  renderSection();
  await flush();
  const before = h.get.mock.calls.length;
  await fire({ instanceId: 'inst-9', contactId: 'contact-2', change: 'issued' });
  assert.equal(h.get.mock.calls.length, before);
});
