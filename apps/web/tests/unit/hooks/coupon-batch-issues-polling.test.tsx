// @vitest-environment jsdom
/**
 * 券詳情頁的發放紀錄自動更新（change fix-coupon-broadcast-immediate-run，
 * spec coupon-management「發放紀錄與廣播列表在發送完成前自動更新」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: vi.fn() } }));

import { CouponBatchHistory } from '#src/components/coupons/detail/CouponBatchHistory.js';

const record = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'b1', name: '批次發放 2026-10-27 10:00', status, couponIssuedVia: 'batch', couponIssuedByName: '阿哲',
  totalCount: 2, couponIssuedCount: status === 'completed' ? 2 : 0, failureReason: null, failureCode: null,
  createdAt: '2026-10-27T02:00:00.000Z', summary: { issued: status === 'completed' ? 2 : 0, pending: 0, skipped: {}, failed: {} },
  ...extra,
});
const reply = (rows: unknown[]) => ({ data: { success: true, data: rows } });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.get.mockReset();
});
afterEach(() => vi.useRealTimers());

function renderHistory() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <CouponBatchHistory couponId="c1" />
    </SWRConfig>,
  );
}
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test('發放紀錄自動更新到已完成', async () => {
  h.get
    .mockResolvedValueOnce(reply([record('scheduled')]))
    .mockResolvedValueOnce(reply([record('sending')]))
    .mockResolvedValue(reply([record('completed')]));
  renderHistory();
  await flush();
  assert.ok(screen.getByText('排入發送'));

  await advance(5_000);
  assert.ok(screen.getByText('發送中'));
  await advance(5_000);
  assert.ok(screen.getByText('已完成'));

  const calls = h.get.mock.calls.length;
  await advance(30_000);
  assert.equal(h.get.mock.calls.length, calls, '完成後不再重新載入');
});

test('發放紀錄顯示失敗原因', async () => {
  h.get
    .mockResolvedValueOnce(reply([record('scheduled')]))
    .mockResolvedValue(reply([record('failed', { failureCode: 'COUPON_NOT_ACTIVE', failureReason: '附上的優惠券已暫停或結束，沒有發送' })]));
  renderHistory();
  await flush();
  await advance(5_000);
  assert.ok(screen.getByText('失敗'));
  assert.ok(screen.getByText(/附上的優惠券已暫停或結束/));
});
