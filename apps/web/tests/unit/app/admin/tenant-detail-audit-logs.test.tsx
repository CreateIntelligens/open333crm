// @vitest-environment jsdom
/**
 * 租戶詳細頁的操作紀錄（change add-platform-tenant-audit-logs，規格 platform-audit-log
 * 「租戶詳細頁顯示操作紀錄」）。平台 API 以 vi.mock 取代，不送 HTTP 請求。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({ audit: { items: [] as unknown[], hasMore: false } }));

const { platformApi } = vi.hoisted(() => ({
  platformApi: {
    get: vi.fn(async (url: string) => {
      if (url === `/tenants/${'11111111-1111-4111-8111-111111111111'}/audit-logs`) return { data: { data: state.audit } };
      if (url === '/plans') return { data: { data: [] } };
      if (url.endsWith('/ai-privacy')) return { data: { data: { enabled: false } } };
      return {
        data: {
          data: {
            id: '11111111-1111-4111-8111-111111111111',
            name: '大同',
            isActive: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            trialEndsAt: null,
            purgedAt: null,
            contractStartDate: null,
            contractEndDate: null,
            plan: null,
            agents: [],
            _count: { agents: 0, channels: 0, contacts: 0, conversations: 0, cases: 0 },
          },
        },
      };
    }),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: TENANT_ID }) }));

import TenantDetailPage from '#src/app/admin/tenants/[id]/page.js';

beforeEach(() => {
  state.audit = { items: [], hasMore: false };
});
afterEach(() => cleanup());

function entry(over: Record<string, unknown>) {
  return {
    id: 'log-1',
    action: 'tenant.disable',
    targetType: 'tenant',
    targetId: TENANT_ID,
    payload: null,
    createdAt: '2026-11-10T02:30:00.000Z',
    actor: { id: 'u1', name: 'Ops', email: 'ops@example.com' },
    targetLabel: '大同',
    targetTenantId: TENANT_ID,
    ...over,
  };
}

test('顯示租戶操作紀錄', async () => {
  state.audit = { items: [entry({})], hasMore: false };
  render(<TenantDetailPage />);

  const section = await screen.findByRole('region', { name: /操作紀錄/ });
  const row = within(section).getByText('停用租戶').closest('tr')!;
  assert.ok(within(row).queryByText('Ops') !== null);
  const link = within(row).getByRole('link', { name: '大同' });
  assert.equal(link.getAttribute('href'), `/admin/tenants/${TENANT_ID}`);
  // 台灣時間（UTC+8）
  assert.ok(within(row).queryByText('2026-11-10 10:30') !== null);
  assert.ok(within(section).queryByText(/只顯示最近/) === null);
});

test('系統排程紀錄與更多紀錄提示', async () => {
  state.audit = { items: [entry({ action: 'tenant.trial.expire', actor: null })], hasMore: true };
  render(<TenantDetailPage />);

  const section = await screen.findByRole('region', { name: /操作紀錄/ });
  const row = within(section).getByText('試用到期停用').closest('tr')!;
  assert.ok(within(row).queryByText('系統排程') !== null);
  assert.ok(within(section).queryByText(/只顯示最近 1 筆/) !== null);
});
