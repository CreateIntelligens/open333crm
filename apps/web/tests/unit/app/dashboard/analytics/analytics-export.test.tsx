// @vitest-environment jsdom
/**
 * 報表匯出（change fix-admin-settings-safeguards，analytics-reports「匯出的 CSV 以 UTF-8 BOM 開頭」）。
 * G12：沒有匯出權限也顯示按鈕，失敗時畫面沒有任何提示。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { perms: new Set<string>() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => auth.perms.has(code) }));
vi.mock('#src/components/layout/Topbar.js', () => ({
  Topbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
const empty = { data: undefined, isLoading: false };
vi.mock('#src/hooks/useAnalytics.js', () => ({
  useOverviewStats: () => empty,
  useMessageTrend: () => empty,
  useCaseAnalytics: () => empty,
  useAgentPerformance: () => empty,
  useChannelAnalytics: () => empty,
  useCouponAnalytics: () => ({ ...empty, mutate: () => undefined }),
}));
for (const m of ['KpiCards', 'MessageTrendChart', 'CaseCategoryPieChart', 'CaseTrendChart', 'AgentPerformanceTable', 'ChannelDistributionChart']) {
  vi.doMock(`#src/components/analytics/${m}.js`, () => ({ [m]: () => null }));
}

const { default: AnalyticsPage } = await import('#src/app/dashboard/analytics/page.js');

beforeEach(() => {
  api.post.mockReset();
});
afterEach(cleanup);

test('沒有匯出權限時不顯示按鈕', () => {
  auth.perms = new Set(['analytics.view']);
  render(<AnalyticsPage />);
  assert.equal(screen.queryAllByText('匯出 CSV').length, 0);
});

test('匯出失敗時顯示錯誤', async () => {
  auth.perms = new Set(['analytics.view', 'analytics.export']);
  api.post.mockRejectedValueOnce({ response: { status: 500, data: new Blob(['{}']) } });
  render(<AnalyticsPage />);
  fireEvent.click(screen.getByText('匯出 CSV'));
  await waitFor(() => assert.ok(screen.queryByRole('alert') !== null));
  assert.match(screen.getByRole('alert').textContent ?? '', /匯出失敗/);
});

test('優惠券成效分頁沒有對應的匯出，不顯示匯出按鈕', async () => {
  auth.perms = new Set(['analytics.view', 'analytics.export']);
  render(<AnalyticsPage />);
  assert.equal(screen.queryAllByText('匯出 CSV').length, 1);
  fireEvent.click(screen.getByRole('button', { name: '優惠券成效' }));
  await waitFor(() => assert.equal(screen.queryAllByText('匯出 CSV').length, 0));
});
