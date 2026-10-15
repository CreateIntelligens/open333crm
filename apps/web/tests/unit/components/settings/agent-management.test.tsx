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
