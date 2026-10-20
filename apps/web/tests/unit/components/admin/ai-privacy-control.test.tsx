// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi: api }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'tenant-1' }) }));
import TenantDetailPage from '#src/app/admin/tenants/[id]/page.js';

const detail = {
  id: 'tenant-1', name: '租戶測試', isActive: true, createdAt: '2026-10-20', trialEndsAt: null, purgedAt: null,
  contractStartDate: null, contractEndDate: null, plan: null, agents: [], _count: { agents: 0, channels: 0, contacts: 0, conversations: 0, cases: 0 },
};
let enabled = false;
let failLoad = false;
beforeEach(() => {
  enabled = false;
  failLoad = false;
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/ai-privacy')) {
      if (failLoad) throw new Error('load failed');
      return { data: { data: { enabled } } };
    }
    return { data: { data: url === '/plans' ? [] : detail } };
  });
  api.patch.mockImplementation(async (_url: string, input: { enabled: boolean }) => {
    enabled = input.enabled;
    return { data: { data: { enabled } } };
  });
});
afterEach(cleanup);

test('Display and update privacy setting', async () => {
  render(<TenantDetailPage />);
  await screen.findByRole('heading', { name: '租戶測試' });
  await waitFor(() => assert.ok(screen.queryByRole('switch', { name: '強制啟用個資遮罩' }) !== null));
  const control = screen.getByRole('switch', { name: '強制啟用個資遮罩' }) as HTMLButtonElement;
  await waitFor(() => assert.equal(control.disabled, false));
  assert.equal(control.getAttribute('aria-checked'), 'false');
  assert.ok(screen.getByText(/2md.ai/));
  fireEvent.click(control);
  await waitFor(() => assert.equal(control.getAttribute('aria-checked'), 'true'));
  assert.deepEqual(api.patch.mock.calls[0], ['/tenants/tenant-1/ai-privacy', { enabled: true }]);
  fireEvent.click(control);
  await waitFor(() => assert.equal(control.getAttribute('aria-checked'), 'false'));
});

test('Display and update privacy setting: persisted enabled and saving state', async () => {
  enabled = true;
  render(<TenantDetailPage />);
  await screen.findByRole('heading', { name: '租戶測試' });
  await waitFor(() => assert.ok(screen.queryByRole('switch') !== null));
  const control = screen.getByRole('switch') as HTMLButtonElement;
  await waitFor(() => assert.equal(control.getAttribute('aria-checked'), 'true'));
  let resolve!: (value: unknown) => void;
  api.patch.mockImplementation(() => new Promise((r) => { resolve = r; }));
  fireEvent.click(control);
  assert.equal(control.disabled, true);
  assert.equal(control.getAttribute('aria-checked'), 'true');
  resolve({ data: { data: { enabled: false } } });
  await waitFor(() => assert.equal(control.getAttribute('aria-checked'), 'false'));
});

test('Failed privacy setting request: failed load can retry', async () => {
  failLoad = true;
  render(<TenantDetailPage />);
  await screen.findByRole('heading', { name: '租戶測試' });
  await waitFor(() => assert.ok(screen.queryByRole('alert') !== null));
  const control = screen.getByRole('switch') as HTMLButtonElement;
  assert.equal(control.disabled, true);
  failLoad = false;
  fireEvent.click(screen.getByRole('button', { name: '重新載入去識別化設定' }));
  await waitFor(() => assert.equal(control.disabled, false));
});

test('Failed privacy setting request: failed save preserves confirmed state', async () => {
  api.patch.mockRejectedValue(new Error('save failed'));
  render(<TenantDetailPage />);
  await screen.findByRole('heading', { name: '租戶測試' });
  await waitFor(() => assert.ok(screen.queryByRole('switch') !== null));
  const control = screen.getByRole('switch') as HTMLButtonElement;
  await waitFor(() => assert.equal(control.disabled, false));
  fireEvent.click(control);
  await screen.findByRole('alert');
  assert.equal(control.getAttribute('aria-checked'), 'false');
  assert.equal(control.disabled, false);
});
