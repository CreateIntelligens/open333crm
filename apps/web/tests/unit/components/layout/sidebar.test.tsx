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
  const auth = { permissions: new Set<string>() };
  return {
    nav: { pathname: '/dashboard/inbox' },
    auth,
    authValue: {
      agent: { id: 'a1', name: '測試成員', email: 'a@example.com', role: 'AGENT' },
      logout: () => {},
      hasPermission: (code: string) => auth.permissions.has(code),
    },
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/providers/AuthProvider', () => ({ useAuth: () => authValue }));

import { Sidebar } from '@/components/layout/Sidebar';

const visible = (label: string) => screen.queryAllByText(label).length > 0;

/** 展開所有折疊的項目，讓檢查只看權限過濾，不受目前位置與分組方式影響。 */
function renderExpanded() {
  const { container } = render(<Sidebar />);
  for (let i = 0; i < 100; i++) {
    // 每次只點一個：同一個項目可能有兩個展開按鈕，連點兩個會再收合。
    const collapsed = container.querySelector('[aria-expanded="false"]');
    if (!collapsed) return;
    fireEvent.click(collapsed);
  }
  throw new Error('展開側邊選單超過 100 次，仍有項目是收合的');
}

beforeEach(() => {
  nav.pathname = '/dashboard/inbox';
  auth.permissions = new Set();
});

test('沒有權限時隱藏選單項目', () => {
  auth.permissions = new Set(['automation.view']);
  renderExpanded();
  assert.equal(visible('自動化'), true, '對照組：有權限的項目要顯示');
  assert.equal(visible('報表'), false);
});

test('有權限時顯示選單項目', () => {
  auth.permissions = new Set(['analytics.view']);
  renderExpanded();
  assert.equal(visible('報表'), true);
});

test('子項目全部隱藏時隱藏上層項目', () => {
  auth.permissions = new Set(['role.view', 'analytics.view']);
  renderExpanded();
  assert.equal(visible('一般設定'), true, '對照組：「設定」已展開');
  assert.equal(visible('整合'), false);

  cleanup();
  auth.permissions = new Set(['role.view', 'analytics.view', 'settings.manage']);
  renderExpanded();
  assert.equal(visible('整合'), true, '對照組：有 settings.manage 時顯示「整合」');
});
