// @vitest-environment jsdom
/**
 * 行銷活動列表的列鍵盤操作：焦點在列上按 Enter 開啟活動；
 * 焦點在列內的「刪除」按鈕按 Enter 時不可冒泡到列而導頁（PR #539 bot 審查）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => true }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/marketing/campaigns',
  useSearchParams: () => null,
  useRouter: () => ({ push }),
}));
vi.mock('#src/hooks/useChannels.js', () => ({ useChannels: () => ({ channels: [] }) }));
const mutate = vi.fn();
vi.mock('#src/hooks/useMarketing.js', () => ({
  useCampaigns: () => ({
    campaigns: [{ id: 'camp-1', name: '雙十一活動', status: 'draft', createdAt: '2026-11-01T00:00:00.000Z', _count: { broadcasts: 0 } }],
    isLoading: false,
    mutate,
  }),
  useSegments: () => ({ segments: [], isLoading: false, mutate }),
  useBroadcasts: () => ({ broadcasts: [], isLoading: false, mutate }),
}));
vi.mock('#src/hooks/useMaterials.js', () => ({ useMaterials: () => ({ materials: [] }) }));
vi.mock('#src/components/materials/MaterialPreview.js', () => ({ MaterialPreview: () => null }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));

import MarketingPage from '#src/app/dashboard/marketing/page.js';

afterEach(() => {
  cleanup();
  push.mockReset();
});

test('焦點在活動列上按 Enter 開啟活動', () => {
  render(<MarketingPage />);
  const row = screen.getAllByRole('row').find((r) => r.getAttribute('tabindex') === '0');
  assert.ok(row);
  fireEvent.keyDown(row, { key: 'Enter' });
  assert.deepEqual(push.mock.calls, [['/dashboard/marketing/campaigns/camp-1']]);
});

test('在刪除按鈕上按 Enter 不會開啟活動', () => {
  render(<MarketingPage />);
  fireEvent.keyDown(screen.getByRole('button', { name: '刪除' }), { key: 'Enter' });
  assert.equal(push.mock.calls.length, 0);
});
