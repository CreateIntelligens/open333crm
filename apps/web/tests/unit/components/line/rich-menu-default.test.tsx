// @vitest-environment jsdom
/**
 * Rich Menu「設為所有好友的預設選單」（change fix-rich-menu-default-safety，spec line-rich-menu
 * 「Default Rich Menu」）。
 *
 * 修正前：新建時預設勾選，選項只寫「使用者開啟對話時自動展開」，發布確認框也沒提到
 * 會換掉所有好友目前的選單；一發布就換掉正式環境全部好友的選單。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('channelId=ch-1'),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/hooks/useRichMenus.js', () => ({ createRichMenu: vi.fn() }));

import NewRichMenuPage from '#src/app/dashboard/line/rich-menus/new/page.js';
import { RichMenuEditor, type RichMenuDraft } from '#src/components/line/rich-menu/RichMenuEditor.js';
import {
  richMenuPublishConfirm,
  richMenuUnpublishConfirm,
} from '#src/lib/rich-menu-confirm.js';

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openEditor() {
  render(<NewRichMenuPage />);
  fireEvent.click(screen.getByRole('button', { name: /2 × 2/ }));
  return screen.getByRole('checkbox', { name: /設為所有好友的預設選單/ }) as HTMLInputElement;
}

test('New draft is not the default：新建時預設不勾', () => {
  const box = openEditor();
  assert.equal(box.checked, false);
});

test('Check the default option：勾選時確認，取消就維持不勾', () => {
  const box = openEditor();
  confirmSpy.mockReturnValue(false);
  fireEvent.click(box);
  assert.equal(confirmSpy.mock.calls.length, 1);
  assert.match(String(confirmSpy.mock.calls[0][0]), /所有好友/);
  assert.equal((screen.getByRole('checkbox', { name: /設為所有好友的預設選單/ }) as HTMLInputElement).checked, false);

  confirmSpy.mockReturnValue(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /設為所有好友的預設選單/ }));
  assert.equal((screen.getByRole('checkbox', { name: /設為所有好友的預設選單/ }) as HTMLInputElement).checked, true);

  // 取消勾選不需要確認
  confirmSpy.mockClear();
  fireEvent.click(screen.getByRole('checkbox', { name: /設為所有好友的預設選單/ }));
  assert.equal(confirmSpy.mock.calls.length, 0);
});

test('Publish a default menu：確認文字說明會換掉所有好友目前的選單', () => {
  assert.match(richMenuPublishConfirm(true), /所有好友/);
  assert.doesNotMatch(richMenuPublishConfirm(false), /所有好友/);
});

test('Unpublish a default menu：確認文字說明所有好友的預設選單會消失', () => {
  assert.match(richMenuUnpublishConfirm(true), /所有好友/);
  assert.doesNotMatch(richMenuUnpublishConfirm(false), /所有好友/);
});

// ── 預設與展開分開（change migrate-line-tenant-ctx，spec「圖文選單展開狀態」） ──

test('新建時「聊天室打開時展開選單」預設勾選', () => {
  openEditor();
  const box = screen.getByRole('checkbox', { name: /聊天室打開時展開選單/ }) as HTMLInputElement;
  assert.equal(box.checked, true);
});

function renderEditor(draft: Partial<RichMenuDraft>) {
  const onChange = vi.fn();
  const full = {
    channelId: 'ch-1',
    name: '選單',
    chatBarText: '選單',
    size: { width: 2500, height: 843 },
    isDefault: false,
    selected: true,
    areas: [],
    imageUrl: '',
    ...draft,
  } as RichMenuDraft;
  render(<RichMenuEditor draft={full} onChange={onChange} />);
  return onChange;
}

test('「設為所有好友的預設選單」寫入 isDefault，不改展開狀態', () => {
  confirmSpy.mockReturnValue(true);
  const onChange = renderEditor({ isDefault: false, selected: false });
  fireEvent.click(screen.getByRole('checkbox', { name: /設為所有好友的預設選單/ }));
  const next = onChange.mock.calls[0][0] as RichMenuDraft;
  assert.equal(next.isDefault, true);
  assert.equal(next.selected, false);
});

test('「聊天室打開時展開選單」寫入 selected，不改預設', () => {
  const onChange = renderEditor({ isDefault: true, selected: true });
  fireEvent.click(screen.getByRole('checkbox', { name: /聊天室打開時展開選單/ }));
  const next = onChange.mock.calls[0][0] as RichMenuDraft;
  assert.equal(next.selected, false);
  assert.equal(next.isDefault, true);
});
