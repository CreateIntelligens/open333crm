// @vitest-environment jsdom
/**
 * 平台升級/加購申請頁（change make-token-topup-monthly，plan-change-request「畫面說明加購僅限當月」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const row = (id: string, tenantName: string, extra: Record<string, unknown>) => ({
  id,
  tenantId: `t-${id}`,
  tenantName,
  currentPlan: '輕量版',
  type: 'token_topup',
  targetPlanSlug: null,
  topupTokens: 500_000,
  note: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

const { platformApi } = vi.hoisted(() => ({
  platformApi: {
    get: vi.fn(async () => ({
      data: {
        data: [
          row('a', '甲租戶', { monthlyTopupTokens: 200_000, monthlyTokenLimit: 1_200_000 }),
          row('b', '乙租戶', { monthlyTopupTokens: 0, monthlyTokenLimit: null }),
        ],
      },
    })),
    patch: vi.fn(),
  },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import PlanChangesPage from '#src/app/admin/plan-changes/page.js';

afterEach(() => cleanup());

const rowOf = async (name: string) => {
  const cell = await screen.findByText(name);
  const tr = cell.closest('tr');
  assert.ok(tr !== null);
  return within(tr as HTMLElement);
};

test('平台審核時看到本月加購量與上限：說明加購僅限當月，無上限顯示「無上限」', async () => {
  render(<PlanChangesPage />);

  assert.ok(screen.queryByText(/加購僅限核准當月（台灣時間），下個月回到方案額度/) !== null);
  const a = await rowOf('甲租戶');
  assert.ok(a.queryByText('本月已加購 200.0k token') !== null);
  assert.ok(a.queryByText('本月上限 1.20M token') !== null);
  const b = await rowOf('乙租戶');
  assert.ok(b.queryByText('本月上限 無上限') !== null);
});

test('核准失敗時顯示後端的錯誤訊息，不會沒有反應', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  platformApi.patch.mockRejectedValueOnce({
    response: { data: { error: { message: '此租戶方案 AI 額度已為無上限，無需加購' } } },
  });
  render(<PlanChangesPage />);

  const a = await rowOf('甲租戶');
  fireEvent.click(a.getByRole('button', { name: '核准' }));

  assert.ok((await screen.findByText('此租戶方案 AI 額度已為無上限，無需加購')) !== null);
  assert.ok(screen.queryByText(/已核准/) === null);
});

test('AI 額度無上限的租戶，加購申請不能核准，並提示改用駁回', async () => {
  render(<PlanChangesPage />);

  const b = await rowOf('乙租戶');
  assert.equal((b.getByRole('button', { name: '核准' }) as HTMLButtonElement).disabled, true);
  assert.ok(b.queryByText('額度已無上限，加購不會生效，請駁回') !== null);
  const a = await rowOf('甲租戶');
  assert.equal((a.getByRole('button', { name: '核准' }) as HTMLButtonElement).disabled, false);
});
