// @vitest-environment jsdom
/**
 * 廣播自動建立的素材短連結要標示來源，改或刪前要警告（M14，2026-10-15 手冊盤點發現）。
 *
 * 修正前：素材短連結沒有標題，列表顯示「-」，與手動連結混在一起；刪除或改目標網址／
 * 到期時間會讓已發給客人的訊息連結失效或導向別處，畫面沒有任何警告。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), delete: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/shortlinks/links' }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/components/shortlink/ClickStatsView.js', () => ({ ClickStatsView: () => null }));
vi.mock('#src/components/shortlink/QrCodeDialog.js', () => ({ QrCodeDialog: () => null }));
vi.mock('#src/hooks/useChannels.js', () => ({ useChannels: () => ({ channels: [] }) }));
vi.mock('#src/hooks/useShortLinks.js', () => ({
  useShortLinks: () => ({
    links: [
      { id: 'l-auto', slug: 'auto1', targetUrl: 'https://shop.example.com', title: null, materialId: 'mat-1', isActive: true, totalClicks: 3, uniqueClicks: 2 },
      { id: 'l-manual', slug: 'manual1', targetUrl: 'https://example.com', title: '手動連結', materialId: null, isActive: true, totalClicks: 0, uniqueClicks: 0 },
    ],
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

import ShortLinksPage from '#src/app/dashboard/shortlinks/page.js';

let confirmSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: [] } });
  api.delete.mockReset();
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function row(slug: string) {
  return screen.getByText(`/s/${slug}`).closest('tr') as HTMLElement;
}

test('素材短連結標示為廣播自動建立，不再顯示「-」', () => {
  render(<ShortLinksPage />);
  assert.ok(within(row('auto1')).queryByText(/廣播自動建立/));
  assert.ok(within(row('manual1')).queryByText(/廣播自動建立/) === null);
});

test('刪除素材短連結時警告已發出的訊息會失效', () => {
  render(<ShortLinksPage />);
  fireEvent.click(within(row('auto1')).getByTitle('刪除'));
  assert.match(String(confirmSpy.mock.calls[0][0]), /已發出|已經發給/);
  assert.equal(api.delete.mock.calls.length, 0);

  fireEvent.click(within(row('manual1')).getByTitle('刪除'));
  assert.doesNotMatch(String(confirmSpy.mock.calls[1][0]), /已發出|已經發給/);
});

test('編輯素材短連結時顯示會影響已發出訊息的警告', () => {
  render(<ShortLinksPage />);
  fireEvent.click(within(row('auto1')).getByTitle('編輯'));
  assert.ok(screen.getByRole('dialog').textContent?.includes('已經發給客人'));
});
