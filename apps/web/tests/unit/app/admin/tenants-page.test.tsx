// @vitest-environment jsdom
/**
 * 平台租戶列表標示合約到期狀態（change add-contract-expiry-reminder，需求「平台租戶列表標示合約到期狀態」）。
 * 今天固定為 2026-11-10（本地時間），只假造 Date，不影響 testing-library 的等待。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const tenant = (id: string, name: string, contractEndDate: string | null) => ({
  id,
  name,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  contractStartDate: contractEndDate ? '2026-01-01T00:00:00.000Z' : null,
  contractEndDate,
  plan: { slug: 'standard', name: '標準版' },
  _count: { agents: 1 },
});

const { platformApi } = vi.hoisted(() => ({
  platformApi: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import TenantsPage from '#src/app/admin/tenants/page.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
  platformApi.get.mockResolvedValue({
    data: {
      data: [
        tenant('t-none', '沒有合約', null),
        tenant('t-far', '九十天後', '2027-02-08T00:00:00.000Z'),
        tenant('t-expired', '昨天到期', '2026-11-09T00:00:00.000Z'),
        tenant('t-soon', '十天後', '2026-11-20T00:00:00.000Z'),
      ],
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const tenantOrder = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('link')[0]!.textContent);

test('列表標示已過期與 30 天內到期', async () => {
  render(<TenantsPage />);
  await screen.findByText('昨天到期');

  assert.ok(within(rowOf('昨天到期')).queryByText('已過期') !== null);
  assert.ok(within(rowOf('十天後')).queryByText('30 天內到期') !== null);
  for (const name of ['九十天後', '沒有合約']) {
    assert.ok(within(rowOf(name)).queryByText('已過期') === null);
    assert.ok(within(rowOf(name)).queryByText('30 天內到期') === null);
  }
});

test('依合約迄日排序', async () => {
  render(<TenantsPage />);
  await screen.findByText('昨天到期');

  fireEvent.click(screen.getByRole('button', { name: /合約期間/ }));
  assert.deepEqual(tenantOrder(), ['昨天到期', '十天後', '九十天後', '沒有合約']);

  fireEvent.click(screen.getByRole('button', { name: /合約期間/ }));
  assert.deepEqual(tenantOrder(), ['九十天後', '十天後', '昨天到期', '沒有合約']);
});
