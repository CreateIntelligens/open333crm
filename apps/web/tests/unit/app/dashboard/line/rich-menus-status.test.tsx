// @vitest-environment jsdom
/**
 * 圖文選單列表頁的狀態（change migrate-line-tenant-ctx，spec line-rich-menu
 * 「發布中斷或失敗的選單可以重新發布」的「列表頁顯示發布中與發布失敗」、「設預設失敗時保留原本的預設」）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('channelId=ch-1'),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/components/line/OaSwitcher.js', () => ({ OaSwitcher: () => null }));
vi.mock('#src/components/line/rich-menu/RichMenuBindDialog.js', () => ({ RichMenuBindDialog: () => null }));

const menus = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const publishRichMenu = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
vi.mock('#src/hooks/useRichMenus.js', () => ({
  useRichMenus: () => ({ richMenus: menus, isLoading: false, mutate }),
  publishRichMenu,
  unpublishRichMenu: vi.fn(),
  deleteRichMenu: vi.fn(),
  duplicateRichMenu: vi.fn(),
}));

import RichMenusPage from '#src/app/dashboard/line/rich-menus/page.js';

const menu = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  status,
  chatBarText: '選單',
  imageUrl: '',
  areas: [],
  isDefault: false,
  selected: true,
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...extra,
});

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  menus.length = 0;
  publishRichMenu.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 名稱所在的卡片 */
function card(name: string) {
  return screen.getByText(name).closest('.rounded-lg') as HTMLElement;
}

test('列表頁顯示發布中與發布失敗：發布中沒有「發布」按鈕，發布失敗有', () => {
  menus.push(
    menu('m1', '發布中的選單', 'publishing', { updatedAt: new Date().toISOString() }),
    menu('m2', '發布失敗的選單', 'error'),
  );
  render(<RichMenusPage />);

  const publishing = card('發布中的選單');
  assert.ok(within(publishing).getByText('發布中'));
  assert.ok(within(publishing).queryByRole('button', { name: /^發布$/ }) === null);

  const failed = card('發布失敗的選單');
  assert.ok(within(failed).getByText('發布失敗'));
  assert.ok(within(failed).getByRole('button', { name: /發布/ }));
});

test('發布回應帶 DEFAULT_NOT_SET：提示沒有設成所有好友的預設選單', async () => {
  menus.push(menu('m1', '預設選單', 'draft', { isDefault: true }));
  publishRichMenu.mockResolvedValue({ id: 'm1', status: 'published', isDefault: false, warnings: ['DEFAULT_NOT_SET'] });
  render(<RichMenusPage />);

  fireEvent.click(within(card('預設選單')).getByRole('button', { name: /發布/ }));
  await waitFor(() => assert.equal(alertSpy.mock.calls.length, 1));
  assert.match(String(alertSpy.mock.calls[0][0]), /沒有設成.*預設/);
  // 設預設失敗時 isDefault 記成 false，取消發布會保留 false：只取消發布再發布，不會再設預設
  assert.match(String(alertSpy.mock.calls[0][0]), /重新勾選「設為所有好友的預設選單」/);
});

test('發布中斷的選單：發布中停留超過 5 分鐘，顯示「發布中斷」並有「發布」按鈕', () => {
  const sixMinutesAgo = new Date(Date.now() - 6 * 60_000).toISOString();
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  menus.push(
    menu('m1', '中斷的選單', 'publishing', { updatedAt: sixMinutesAgo }),
    menu('m2', '還在發布的選單', 'publishing', { updatedAt: oneMinuteAgo }),
  );
  render(<RichMenusPage />);

  const interrupted = card('中斷的選單');
  assert.ok(within(interrupted).getByText('發布中斷'));
  assert.ok(within(interrupted).getByRole('button', { name: /^發布$/ }));

  const running = card('還在發布的選單');
  assert.ok(within(running).getByText('發布中'));
  assert.ok(within(running).queryByRole('button', { name: /^發布$/ }) === null);
});
