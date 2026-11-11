// @vitest-environment jsdom
/**
 * 券詳情頁的發放紀錄（add-coupon-system A15 15.24、design D31）：送出後在券詳情頁看到結果，
 * 依原因列出跳過與失敗人數；失敗時顯示原因。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  records: [] as unknown[],
}));
vi.mock('#src/hooks/useCouponBatchIssue.js', () => ({
  useCouponBatchIssues: () => ({ records: h.records, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

import { CouponBatchHistory } from '#src/components/coupons/detail/CouponBatchHistory.js';

const base = {
  couponIssuedVia: 'batch', couponIssuedByName: '座席阿哲', totalCount: 3, couponIssuedCount: 1,
  failureReason: null, failureCode: null, createdAt: '2026-10-22T07:30:00.000Z',
};

test('對象沒有這個渠道的身分', () => {
  h.records = [{
    ...base, id: 'b1', name: '批次發放 2026-10-22 15:30', status: 'completed',
    summary: { issued: 1, pending: 0, skipped: { NO_CHANNEL_IDENTITY: 1 }, failed: { DELIVERY_FAILED: 1 } },
  }];
  render(<CouponBatchHistory couponId="c1" />);
  assert.ok(screen.getByText('批次發放 2026-10-22 15:30'));
  assert.ok(screen.getByText(/座席阿哲/));
  assert.ok(screen.getByText('因沒有這個渠道的身分跳過 1'));
  assert.ok(screen.getByText('訊息送不出（顧客可能已封鎖） 1'));
});

test('LINE 訊息額度不足', () => {
  h.records = [{
    ...base, id: 'b2', name: '批次發放 2026-10-22 16:00', status: 'failed', couponIssuedCount: 0,
    failureCode: 'LINE_QUOTA_INSUFFICIENT', failureReason: '官方帳號本月剩餘訊息額度 1 則，少於這次要發送的 3 人',
    summary: { issued: 0, pending: 0, skipped: {}, failed: {} },
  }];
  render(<CouponBatchHistory couponId="c1" />);
  assert.ok(screen.getByText(/剩餘訊息額度 1 則/));
  assert.ok(screen.getByText(/提高本月訊息額度/));
});

test('沒有發放紀錄時不顯示', () => {
  h.records = [];
  const { container } = render(<CouponBatchHistory couponId="c1" />);
  assert.ok(container.firstChild === null);
});
