// @vitest-environment jsdom
/**
 * 設定頁的「角色與權限」分頁（openspec/specs/role-settings-page「沒有 role.manage 時唯讀」）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn((_url: string) => new Promise(() => {})), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/settings/roles' }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => false }));

import SettingsPage from '#src/app/dashboard/settings/page.js';

test('沒有 role.view 時不顯示角色設定頁', () => {
  render(<SettingsPage />);
  assert.ok(screen.getByText('你沒有查看此設定的權限。'));
  assert.equal(api.get.mock.calls.some(([url]) => String(url).startsWith('/roles')), false);
});
