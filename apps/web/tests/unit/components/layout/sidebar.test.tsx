// @vitest-environment jsdom
/**
 * 側邊選單依權限顯示項目（openspec/specs/permission-check「前端依權限顯示選單」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// useAuth() 回傳同一個物件，如同 AuthProvider 以 useCallback 保持 hasPermission 不變。
// 每次渲染都給新的 hasPermission 會讓 Sidebar 的 effect 無限重跑。
const { nav, auth, authValue } = vi.hoisted(() => {
  const auth = { permissions: new Set<string>(), permissionsError: false };
  return {
    nav: { pathname: '/dashboard/inbox' },
    auth,
    authValue: {
      agent: { id: 'a1', name: '測試成員', email: 'a@example.com', role: 'AGENT' },
      logout: () => {},
      hasPermission: (code: string) => auth.permissions.has(code),
      get permissionsError() {
        return auth.permissionsError;
      },
      reloadPermissions: vi.fn(async () => {}),
    },
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('#src/providers/AuthProvider.js', () => ({ useAuth: () => authValue }));

import { Sidebar, SectionNav } from '#src/components/layout/Sidebar.js';

// 圖示欄只有圖示，名稱放在 aria-label；子選單是文字連結。兩者都用 link 的可及名稱判斷。
const visible = (label: string | RegExp) => screen.queryAllByRole('link', { name: label }).length > 0;

beforeEach(() => {
  nav.pathname = '/dashboard/inbox';
  auth.permissions = new Set();
  auth.permissionsError = false;
  authValue.reloadPermissions.mockClear();
});

test('權限載入失敗時顯示提示並可重試：側邊選單', () => {
  render(<Sidebar />);
  assert.equal(screen.queryAllByRole('button', { name: /重試/ }).length, 0, '對照組：載入成功時不顯示');
  cleanup();

  auth.permissionsError = true;
  render(<Sidebar />);
  fireEvent.click(screen.getByRole('button', { name: /無法載入你的權限.*重試/ }));
  assert.equal(authValue.reloadPermissions.mock.calls.length, 1);
});

test('沒有權限時隱藏選單項目', () => {
  auth.permissions = new Set(['automation.view']);
  render(<Sidebar />);
  assert.equal(visible('自動化'), true, '對照組：有權限的項目要顯示');
  assert.equal(visible('報表'), false);
});

test('有權限時顯示選單項目', () => {
  auth.permissions = new Set(['analytics.view']);
  render(<Sidebar />);
  assert.equal(visible('報表'), true);
});

test('子選單依權限顯示項目', () => {
  nav.pathname = '/dashboard/settings/general';
  auth.permissions = new Set(['role.view']);
  render(<SectionNav />);
  assert.equal(visible('一般設定'), true, '對照組：進入「設定」時顯示子選單');
  assert.equal(visible('角色權限'), true, '有 role.view 時顯示「角色權限」');
  assert.equal(visible('A2A'), false, '沒有 settings.manage 時隱藏「A2A」');

  cleanup();
  auth.permissions = new Set(['role.view', 'settings.manage']);
  render(<SectionNav />);
  assert.equal(visible('A2A'), true, '對照組：有 settings.manage 時顯示「A2A」');
});

test('沒有子頁的區塊不顯示子選單', () => {
  nav.pathname = '/dashboard/inbox';
  const { container } = render(<SectionNav />);
  assert.equal(container.innerHTML, '');
});

test('點有子選單的圖示會直接進第一個子頁', () => {
  auth.permissions = new Set(['knowledge.view']);
  render(<Sidebar />);
  const link = screen.getByRole('link', { name: '知識庫' });
  assert.equal(link.getAttribute('href'), '/dashboard/knowledge/articles');
  assert.equal(
    screen.getByRole('link', { name: '收件匣' }).getAttribute('href'),
    '/dashboard/inbox',
    '對照組：沒有子選單的區塊維持原本網址',
  );
});

test('停在區塊首頁時，子選單第一項呈現選中', () => {
  auth.permissions = new Set(['knowledge.view']);
  nav.pathname = '/dashboard/knowledge';
  render(<SectionNav />);
  assert.equal(screen.getByRole('link', { name: '文章管理' }).getAttribute('aria-current'), 'page');
  assert.equal(screen.getByRole('link', { name: '語義搜尋' }).getAttribute('aria-current'), null);
  assert.equal(screen.queryAllByRole('link', { name: '知識庫' }).length, 0, '子選單標題不是連結');
});

test('窄螢幕：圖示欄常駐，點有子頁的圖示彈出子選單，選了就收起', () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  try {
    auth.permissions = new Set(['knowledge.view']);
    render(<Sidebar />);
    const trigger = screen.getByRole('button', { name: '知識庫' });
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryAllByRole('link', { name: '文章管理' }).length, 0, '對照組：還沒點之前沒有子選單');
    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const link = screen.getByRole('link', { name: '文章管理' });
    fireEvent.click(link);
    assert.equal(screen.queryAllByRole('link', { name: '文章管理' }).length, 0, '選了之後子選單收起');
    assert.equal(screen.getByRole('link', { name: '收件匣' }).getAttribute('href'), '/dashboard/inbox', '沒有子頁的圖示維持連結');
  } finally {
    window.matchMedia = original;
  }
});
