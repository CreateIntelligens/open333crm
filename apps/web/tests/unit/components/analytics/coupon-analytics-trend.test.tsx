// @vitest-environment jsdom
/**
 * 「優惠券成效」每日趨勢圖：發出與核銷數字相同時兩條線重疊，核銷線要看得出來（操作手冊實測 2026-10-22）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render } from '@testing-library/react';

// jsdom 量不到容器尺寸，ResponsiveContainer 不會畫圖；改成固定尺寸
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width: 800, height: 280 }),
  };
});

import { CouponAnalyticsPanel } from '#src/components/analytics/CouponAnalyticsPanel.js';

test('發出與核銷同值時，核銷線以虛線畫在上層，兩條線都看得到', () => {
  const data = {
    totals: { issued: 2, claimed: 2, redeemed: 2, linkOpened: 2, redeemRate: 100 },
    trend: [
      { date: '2020-03-01', issued: 0, redeemed: 0 },
      { date: '2020-03-02', issued: 2, redeemed: 2 },
    ],
    topCoupons: [],
  };
  const { container } = render(<CouponAnalyticsPanel data={data} isLoading={false} error={undefined} onRetry={() => undefined} />);
  const curves = [...container.querySelectorAll('path.recharts-line-curve')];
  assert.equal(curves.length, 2);
  const redeemed = curves.find((c) => c.getAttribute('stroke') === 'var(--series-redeemed)');
  assert.ok(redeemed, '找不到核銷線');
  // 動畫期間 recharts 會寫入 0px 0px，這裡比對實際的虛線樣式
  assert.equal(redeemed.getAttribute('stroke-dasharray'), '6 4', '核銷線應為虛線');
});
