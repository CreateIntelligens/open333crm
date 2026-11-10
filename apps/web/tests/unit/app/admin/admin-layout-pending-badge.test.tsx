// @vitest-environment jsdom
/**
 * 平台後台側欄的待審申請數量（change add-plan-change-platform-notify，
 * 主規格 plan-change-request「平台側欄顯示待審申請數量」）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const pendingRequest = (id: string) => ({
  id,
  tenantName: `租戶 ${id}`,
  currentPlan: null,
  type: 'token_topup',
  targetPlanSlug: null,
  topupTokens: 100000,
  note: null,
  createdAt: '2026-11-10T00:00:00.000Z',
});

const state = vi.hoisted(() => ({ pending: [] as unknown[], pathname: '/admin/tenants' }));

const { platformApi } = vi.hoisted(() => ({
  platformApi: {
    get: vi.fn(async (url: string) => {
      if (url === '/plan-change-requests') return { data: { data: state.pending } };
      return { data: { data: [] } };
    }),
    patch: vi.fn(async () => ({ data: { data: {} } })),
    post: vi.fn(),
  },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({
  platformApi,
  getPlatformToken: () => 'platform-token',
  setPlatformToken: () => {},
  getMustChangePassword: () => false,
}));

const router = { replace: () => {}, push: () => {} };
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => router,
}));

import AdminLayout from '#src/app/admin/layout.js';
import PlanChangesPage from '#src/app/admin/plan-changes/page.js';

const navLink = () => screen.getByRole('link', { name: /升級申請/ });

beforeEach(() => {
  state.pending = [];
  state.pathname = '/admin/tenants';
  platformApi.get.mockClear();
});
afterEach(() => cleanup());

test('有待審申請時顯示數量', async () => {
  state.pending = [pendingRequest('a'), pendingRequest('b')];
  render(<AdminLayout><div /></AdminLayout>);

  await waitFor(() => assert.equal(navLink().textContent, '升級申請2'));
  assert.ok(screen.queryByLabelText('2 筆待審申請') !== null);
});

test('沒有待審申請時不顯示數量', async () => {
  render(<AdminLayout><div /></AdminLayout>);

  await waitFor(() => assert.ok(platformApi.get.mock.calls.some(([url]) => url === '/plan-change-requests')));
  assert.equal(navLink().textContent, '升級申請');
  assert.ok(screen.queryByLabelText(/筆待審申請/) === null);
});

test('審核後數量更新', async () => {
  state.pending = [pendingRequest('a'), pendingRequest('b')];
  state.pathname = '/admin/plan-changes';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<AdminLayout><PlanChangesPage /></AdminLayout>);
  await waitFor(() => assert.equal(navLink().textContent, '升級申請2'));

  // 核准第一筆後，API 只剩一筆待審
  platformApi.patch.mockImplementationOnce(async () => {
    state.pending = [pendingRequest('b')];
    return { data: { data: {} } };
  });
  fireEvent.click(screen.getAllByRole('button', { name: '核准' })[0]);

  await waitFor(() => assert.equal(navLink().textContent, '升級申請1'));
});
