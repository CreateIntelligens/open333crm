// @vitest-environment jsdom
/**
 * 數據報表的「優惠券成效」分頁（add-coupon-system 12.16）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { describe, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { CouponAnalyticsPanel } from '#src/components/analytics/CouponAnalyticsPanel.js';

const DATA = {
  totals: { issued: 6, claimed: 4, redeemed: 2, linkOpened: 5, redeemRate: 50 },
  trend: [
    { date: '2020-03-02', issued: 1, redeemed: 0 },
    { date: '2020-03-05', issued: 2, redeemed: 2 },
  ],
  topCoupons: [
    { couponId: 'k1', name: '秋季回饋', issued: 4, claimed: 3, redeemed: 2, linkOpened: 4, redeemRate: 66.7 },
    { couponId: 'k2', name: '小額致歉金', issued: 2, claimed: 1, redeemed: 0, linkOpened: 1, redeemRate: 0 },
  ],
};

describe('優惠券成效', () => {
  test('顯示總數與核銷率', () => {
    render(<CouponAnalyticsPanel data={DATA} isLoading={false} error={undefined} onRetry={() => {}} />);
    const kpi = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[data-kpi]')].find((el) => el.querySelector('p')?.textContent === label)!;
    assert.ok(within(kpi('發出')).getByText('6'));
    assert.ok(within(kpi('已領取')).getByText('4'));
    assert.ok(within(kpi('已核銷')).getByText('2'));
    assert.ok(within(kpi('核銷率')).getByText('50%'));
    assert.ok(within(kpi('發出')).getByText('開啟連結 5 張'));
  });

  test('券排行列出名稱、張數與核銷率，可連到券詳情', () => {
    render(<CouponAnalyticsPanel data={DATA} isLoading={false} error={undefined} onRetry={() => {}} />);
    const table = screen.getByRole('table', { name: '券排行' });
    const rows = within(table).getAllByRole('row').slice(1);
    assert.equal(rows.length, 2);
    const link = within(rows[0]).getByRole('link', { name: '秋季回饋' }) as HTMLAnchorElement;
    assert.equal(link.getAttribute('href'), '/dashboard/marketing/coupons/k1');
    assert.ok(within(rows[0]).getByText('66.7%'));
  });

  test('每日明細可用表格檢視', () => {
    render(<CouponAnalyticsPanel data={DATA} isLoading={false} error={undefined} onRetry={() => {}} />);
    const table = screen.getByRole('table', { name: '每日發放與核銷' });
    assert.ok(within(table).getByText('2020-03-05'));
  });

  test('沒有資料', () => {
    render(<CouponAnalyticsPanel data={{ totals: { issued: 0, claimed: 0, redeemed: 0, linkOpened: 0, redeemRate: null }, trend: [], topCoupons: [] }} isLoading={false} error={undefined} onRetry={() => {}} />);
    assert.ok(screen.getByText('這段期間沒有發出優惠券'));
    const rate = [...document.querySelectorAll<HTMLElement>('[data-kpi]')].find((el) => el.querySelector('p')?.textContent === '核銷率')!;
    assert.ok(within(rate).getByText('—'));
  });

  test('載入失敗顯示原因並可重試', () => {
    const onRetry = vi.fn();
    render(<CouponAnalyticsPanel data={undefined} isLoading={false} error={new Error('x')} onRetry={onRetry} />);
    assert.ok(within(screen.getByRole('alert')).getByText(/無法載入優惠券成效/));
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    assert.equal(onRetry.mock.calls.length, 1);
  });
});
