// @vitest-environment jsdom
/**
 * 附券廣播的結果（add-coupon-system A15 15.24、spec「附券廣播的跳過與回報」）：
 * 發券張數、依原因分列的跳過與失敗人數，並列出失敗與跳過的收件人。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get } }));

import { BroadcastCouponResult } from '#src/components/marketing/BroadcastCouponResult.js';

test('名額不足', async () => {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/marketing/broadcasts/b1') {
      return { data: { data: { id: 'b1', name: '秋季廣播', couponSummary: { issued: 2, pending: 0, skipped: { TOTAL_LIMIT_REACHED: 1 }, failed: { COUPON_MESSAGE_FAILED: 1 } } } } };
    }
    if (url.startsWith('/marketing/broadcasts/b1/recipients?status=skipped')) {
      return { data: { data: [{ contactId: 'c3', displayName: '陳小明', deliveryStatus: 'skipped', reason: 'TOTAL_LIMIT_REACHED' }], meta: { total: 1 } } };
    }
    if (url.startsWith('/marketing/broadcasts/b1/recipients?status=failed')) {
      return { data: { data: [{ contactId: 'c4', displayName: '林阿姨', deliveryStatus: 'failed', reason: 'COUPON_MESSAGE_FAILED' }], meta: { total: 1 } } };
    }
    throw new Error(url);
  });
  render(<BroadcastCouponResult broadcastId="b1" />);
  await screen.findByText('發券 2');
  assert.ok(screen.getByText('因發行總量已發完跳過 1'));
  assert.ok(screen.getByText('素材已送達，優惠券訊息送不出 1'));
  assert.ok(screen.getByText('陳小明'));
  assert.ok(screen.getByText('林阿姨'));
  const url = String(h.get.mock.calls.find(([u]) => String(u).includes('/recipients'))?.[0]);
  assert.match(url, /status=/, '只列跳過與失敗的人');
});

test('結果載入失敗時說明原因', async () => {
  h.get.mockRejectedValue({ response: { status: 500, data: { error: { message: '系統忙碌' } } } });
  render(<BroadcastCouponResult broadcastId="b1" />);
  await screen.findByText(/系統忙碌/);
});

// ─── 一般群發的結果（change fix-plain-broadcast-send-362，spec broadcast-failure-reason「所有廣播都可以查看收件人結果」）───

test('一般群發的結果列出失敗的人', async () => {
  h.get.mockReset();
  h.get.mockImplementation(async (url: string) => {
    if (url === '/marketing/broadcasts/b2') {
      return { data: { data: { id: 'b2', name: '週年慶', couponId: null, successCount: 1, failedCount: 1, skippedCount: 0, couponSummary: null } } };
    }
    if (url.startsWith('/marketing/broadcasts/b2/recipients?status=failed')) {
      return { data: { data: [{ contactId: 'c2', displayName: '乙', deliveryStatus: 'failed', reason: 'DELIVERY_FAILED' }], meta: { total: 1 } } };
    }
    if (url.startsWith('/marketing/broadcasts/b2/recipients?status=skipped')) {
      return { data: { data: [], meta: { total: 0 } } };
    }
    throw new Error(url);
  });
  render(<BroadcastCouponResult broadcastId="b2" />);
  await screen.findByText('成功 1');
  assert.ok(screen.getByText('失敗 1'));
  assert.ok(screen.getByText('乙'));
  assert.ok(screen.getByText('訊息送不出（顧客可能已封鎖）'));
});
