// @vitest-environment jsdom
/**
 * 租戶端方案頁（change make-token-topup-monthly，plan-change-request「畫面說明加購僅限當月」）。
 * 本分支的方案頁把「升級方案／加購 Token」改成分頁（role=tab），查詢改用 tab，測試目的不變。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

const { api, state } = vi.hoisted(() => {
  const state = {
    reqs: [] as unknown[],
    eligibility: { allowed: true, monthlyTokenLimit: 1_000_000 as number | null },
  };
  return {
    state,
    api: {
      get: vi.fn(async (url: string) =>
        url === '/plan-change/topup-eligibility' ? { data: { data: state.eligibility } } : { data: { data: state.reqs } },
      ),
      post: vi.fn(),
    },
  };
});
vi.mock('#src/lib/api.js', () => ({ default: api }));

import PlanPage from '#src/app/dashboard/plan/page.js';

beforeEach(() => {
  state.reqs = [
    // UTC 2026-11-30 16:30 是台灣時間 2026-12-01 00:30
    request('r-approved', { reviewedAt: '2026-11-30T16:30:00.000Z' }),
    request('r-pending', { status: 'pending' }),
  ];
  state.eligibility = { allowed: true, monthlyTokenLimit: 1_000_000 };
});
afterEach(() => cleanup());

test('已核准的加購顯示有效月份：台灣時間 2026-12-01 00:30 核准，顯示「限 2026-12 使用」', async () => {
  render(<PlanPage />);

  assert.ok((await screen.findByText(/限 2026-12 使用/)) !== null);
  assert.equal(screen.queryAllByText(/限 \d{4}-\d{2} 使用/).length, 1, '待審的申請不顯示有效月份');
});

test('租戶選擇加購時看到當月限制：點「加購 Token」後顯示說明', async () => {
  state.reqs = [];
  render(<PlanPage />);

  fireEvent.click(await screen.findByRole('tab', { name: '加購 Token' }));

  assert.ok(screen.queryByText('加購的額度只在核准當月（台灣時間）有效，下個月回到方案額度。') !== null);
});

test('AI 額度無上限時不能申請加購：「加購 Token」停用並顯示說明', async () => {
  state.reqs = [];
  state.eligibility = { allowed: false, monthlyTokenLimit: null };
  render(<PlanPage />);

  assert.ok((await screen.findByText('目前方案的 AI 額度已無上限，不需要加購')) !== null);
  assert.equal((screen.getByRole('tab', { name: '加購 Token' }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole('tab', { name: '升級方案' }) as HTMLButtonElement).disabled, false);
});
