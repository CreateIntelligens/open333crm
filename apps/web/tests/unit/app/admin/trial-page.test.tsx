// @vitest-environment jsdom
/**
 * 平台後台的試用管理頁（openspec/specs/trial-data-purge「平台後台顯示軟刪狀態」）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const tenant = (id: string, name: string, extra: Record<string, unknown>) => ({
  id,
  name,
  isActive: false,
  trialEndsAt: '2026-08-01T00:00:00.000Z',
  daysLeft: -76,
  planName: '試用',
  agentCount: 1,
  ...extra,
});

const { platformApi } = vi.hoisted(() => ({
  platformApi: {
    get: vi.fn(async (url: string) => {
      if (url === '/trial-tenants') {
        return {
          data: {
            data: [
              tenant('t-purged', '已清除的站台', { purgedAt: '2026-09-01T00:00:00.000Z', status: 'purged' }),
              tenant('t-disabled', '停用的站台', { purgedAt: null, status: 'disabled' }),
            ],
          },
        };
      }
      if (url === '/trial-signups') return { data: { data: [] } };
      return { data: { data: null } };
    }),
    put: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import TrialPage from '#src/app/admin/trial/page.js';

const rowOf = async (name: string) => {
  const cell = await screen.findByText(name);
  const row = cell.closest('tr');
  assert.ok(row !== null);
  return within(row as HTMLElement);
};

test('已清除的租戶只能復原', async () => {
  render(<TrialPage />);

  const purged = await rowOf('已清除的站台');
  assert.ok(purged.queryByText('已清除') !== null);
  assert.ok(purged.queryByRole('button', { name: '復原' }) !== null);
  assert.ok(purged.queryByRole('button', { name: '延長' }) === null);
  assert.ok(purged.queryByRole('combobox') === null, '沒有轉正式的選單');

  const disabled = await rowOf('停用的站台');
  assert.ok(disabled.queryByRole('button', { name: '延長' }) !== null);
  assert.ok(disabled.queryByRole('button', { name: '復原' }) === null);
});
