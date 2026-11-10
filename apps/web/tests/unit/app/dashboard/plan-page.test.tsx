// @vitest-environment jsdom
/**
 * 租戶端方案頁（change make-token-topup-monthly，plan-change-request「畫面說明加購僅限當月」）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const request = (id: string, extra: Record<string, unknown>) => ({
  id,
  type: 'token_topup',
  targetPlanSlug: null,
  topupTokens: 200_000,
  note: null,
  status: 'approved',
  reviewedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(async () => ({
      data: {
        data: [
          // UTC 2026-11-30 16:30 是台灣時間 2026-12-01 00:30
          request('r-approved', { reviewedAt: '2026-11-30T16:30:00.000Z' }),
          request('r-pending', { status: 'pending' }),
        ],
      },
    })),
    post: vi.fn(),
  },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import PlanPage from '#src/app/dashboard/plan/page.js';

test('已核准的加購顯示有效月份：台灣時間 2026-12-01 00:30 核准，顯示「限 2026-12 使用」', async () => {
  render(<PlanPage />);

  assert.ok((await screen.findByText(/限 2026-12 使用/)) !== null);
  assert.equal(screen.queryAllByText(/限 \d{4}-\d{2} 使用/).length, 1, '待審的申請不顯示有效月份');
});

test('租戶選擇加購時看到當月限制：點「加購 Token」後顯示說明', async () => {
  api.get.mockResolvedValueOnce({ data: { data: [] } });
  render(<PlanPage />);

  fireEvent.click(await screen.findByRole('button', { name: '加購 Token' }));

  assert.ok(screen.queryByText('加購的額度只在核准當月（台灣時間）有效，下個月回到方案額度。') !== null);
});
