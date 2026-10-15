// @vitest-environment jsdom
/**
 * 人員管理頁。
 * - G17／AUDIT AUTH-09：停用的成員要列出來並可重新啟用（openspec agent-lifecycle「重新啟用成員」）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, auth, authValue } = vi.hoisted(() => {
  const auth = { perms: new Set<string>() };
  return {
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    auth,
    authValue: { agent: { id: 'me', name: '我', email: 'me@example.test', role: 'SUPERVISOR' } },
  };
});
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({
  useAuth: () => authValue,
  usePermission: (code: string) => auth.perms.has(code),
}));

import { AgentManagement } from '#src/components/settings/AgentManagement.js';

const agent = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, email: `${id}@example.test`, role: 'AGENT', roleId: 'r-agent',
  roleRef: { id: 'r-agent', name: '客服', slug: 'agent', isSystem: true },
  isActive: true, teams: [], _count: { assignedCases: 0 }, ...extra,
});
const ROLES = [
  { id: 'r-admin', slug: 'admin', name: '管理員', isSystem: true, permissionCount: 0, agentCount: 1 },
  { id: 'r-agent', slug: 'agent', name: '客服', isSystem: true, permissionCount: 0, agentCount: 1 },
];

function mockApi(inactive: unknown[] = []) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/agents') return { data: { data: [agent('a1', '王小明')] } };
    if (url === '/agents/inactive') return { data: { data: inactive } };
    if (url === '/roles') return { data: { data: { roles: ROLES } } };
    return { data: { data: [] } };
  });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: {} });
});
afterEach(cleanup);

test('有 agent.deactivate 時列出停用的成員並可重新啟用', async () => {
  auth.perms = new Set(['agent.view', 'agent.deactivate']);
  mockApi([agent('d1', '李停用', { isActive: false })]);
  render(<AgentManagement />);
  const section = (await screen.findByText('已停用的人員')).closest('section') as HTMLElement;
  assert.ok(within(section).getByText('李停用'));
  fireEvent.click(within(section).getByRole('button', { name: '重新啟用' }));
  await waitFor(() => assert.ok(api.post.mock.calls.some(([url]) => url === '/agents/d1/reactivate')));
});

test('沒有 agent.deactivate 時不查詢停用的成員', async () => {
  auth.perms = new Set(['agent.view']);
  mockApi([agent('d1', '李停用', { isActive: false })]);
  render(<AgentManagement />);
  await screen.findByText('王小明');
  assert.equal(api.get.mock.calls.some(([url]) => url === '/agents/inactive'), false);
  assert.equal(screen.queryAllByText('已停用的人員').length, 0);
});

test('編輯時角色沒改就不重送角色', async () => {
  // G19：每次儲存都重送角色，主管編輯自己或管理員一定失敗，同一次改的密碼與渠道也沒存
  auth.perms = new Set(['agent.view', 'agent.role.assign', 'agent.password.reset']);
  mockApi();
  render(<AgentManagement />);
  await screen.findByText('王小明');
  fireEvent.click(screen.getByRole('button', { name: /編輯/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText('至少 8 個字元'), { target: { value: 'new-password-1' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }));
  await waitFor(() => assert.ok(api.patch.mock.calls.some(([url]) => url === '/agents/a1/password')));
  assert.equal(api.patch.mock.calls.some(([url]) => url === '/agents/a1/role'), false);
});

test('編輯時改了角色才送角色', async () => {
  auth.perms = new Set(['agent.view', 'agent.role.assign']);
  mockApi();
  render(<AgentManagement />);
  await screen.findByText('王小明');
  fireEvent.click(screen.getByRole('button', { name: /編輯/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'r-admin' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }));
  await waitFor(() => assert.ok(api.patch.mock.calls.some(([url]) => url === '/agents/a1/role')));
});
