// @vitest-environment jsdom
/**
 * 圖文選單編輯頁的發布狀態（change migrate-line-tenant-ctx，spec line-rich-menu
 * 「發布中斷或失敗的選單可以重新發布」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'm1' }),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/components/line/rich-menu/RichMenuEditor.js', () => ({ RichMenuEditor: () => null }));

const state = vi.hoisted(() => ({ richMenu: null as Record<string, unknown> | null }));
const mutate = vi.hoisted(() => vi.fn());
vi.mock('#src/hooks/useRichMenus.js', () => ({
  useRichMenu: () => ({ richMenu: state.richMenu, isLoading: false, mutate }),
  updateRichMenu: vi.fn(),
  publishRichMenu: vi.fn(),
  unpublishRichMenu: vi.fn(),
}));

import EditRichMenuPage from '#src/app/dashboard/line/rich-menus/[id]/page.js';

const menu = (status: string, updatedAt: string) => ({
  id: 'm1',
  channelId: 'ch-1',
  name: '選單',
  chatBarText: '選單',
  size: { width: 2500, height: 843 },
  areas: [],
  imageUrl: '',
  isDefault: false,
  selected: true,
  status,
  updatedAt,
});

afterEach(cleanup);

test('發布中斷的選單：編輯頁顯示「發布中斷」並有「發布到 LINE」按鈕，不能儲存草稿', () => {
  state.richMenu = menu('publishing', new Date(Date.now() - 6 * 60_000).toISOString());
  render(<EditRichMenuPage />);

  assert.ok(screen.getByText('發布中斷'));
  assert.ok(screen.getByRole('button', { name: /發布到 LINE/ }));
  assert.ok(screen.queryByRole('button', { name: /儲存草稿/ }) === null);
});

test('還在發布中的選單：編輯頁沒有「發布到 LINE」與「儲存草稿」按鈕', () => {
  state.richMenu = menu('publishing', new Date(Date.now() - 60_000).toISOString());
  render(<EditRichMenuPage />);

  assert.ok(screen.getByText('發布中'));
  assert.ok(screen.queryByRole('button', { name: /發布到 LINE/ }) === null);
  assert.ok(screen.queryByRole('button', { name: /儲存草稿/ }) === null);
});
