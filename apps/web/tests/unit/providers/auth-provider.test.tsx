// @vitest-environment jsdom
/**
 * 登入後載入權限（openspec/specs/permission-check「前端依權限顯示選單」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/api', () => ({ default: api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/webtalk', () => ({ unmountWebTalk: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({ id: 'cred' })),
  startRegistration: vi.fn(),
}));

import { AuthProvider, setAccessToken, useAuth, usePermission } from '@/providers/AuthProvider';

const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
const AGENT = { id: 'a1', name: '測試成員', email: 'a@example.com', role: 'AGENT' };

type Probe = { auth: ReturnType<typeof useAuth>; canViewAnalytics: boolean };
function renderProvider() {
  const probe = {} as Probe;
  function Capture() {
    probe.auth = useAuth();
    probe.canViewAnalytics = usePermission('analytics.view');
    return null;
  }
  render(<AuthProvider><Capture /></AuthProvider>);
  return probe;
}

/** routes 對應 `METHOD path`。沒有列出的請求一律失敗，等同未登入。 */
function mockApi(routes: Record<string, () => Promise<unknown>>) {
  const handle = (method: string) => (url: string) =>
    routes[`${method} ${url}`]?.() ?? Promise.reject(new Error(`${method} ${url}`));
  api.get.mockImplementation(handle('GET'));
  api.post.mockImplementation(handle('POST'));
}

beforeEach(() => {
  vi.clearAllMocks();
  setAccessToken(null);
});

test('以密碼登入後載入權限', async () => {
  mockApi({
    'POST /auth/login': () => ok({ accessToken: 't', agent: AGENT }),
    'GET /auth/me/permissions': () => ok({ permissions: ['analytics.view'] }),
  });
  const probe = renderProvider();
  await waitFor(() => assert.equal(probe.auth.isLoading, false));
  assert.equal(probe.canViewAnalytics, false, '對照組：登入前沒有權限');

  await act(() => probe.auth.login('a@example.com', 'pw'));
  assert.equal(probe.canViewAnalytics, true);
});

test('以 Passkey 登入後載入權限', async () => {
  mockApi({
    'POST /auth/passkeys/authentication/options': () => ok({ challengeId: 'c1', options: {} }),
    'POST /auth/passkeys/authentication/verify': () => ok({ accessToken: 't', agent: AGENT }),
    'GET /auth/me/permissions': () => ok({ permissions: ['analytics.view'] }),
  });
  const probe = renderProvider();
  await waitFor(() => assert.equal(probe.auth.isLoading, false));
  assert.equal(probe.canViewAnalytics, false, '對照組：登入前沒有權限');

  await act(() => probe.auth.loginWithPasskey('a@example.com'));
  assert.equal(probe.auth.agent?.id, 'a1');
  assert.equal(probe.canViewAnalytics, true);
});

test('權限載入失敗時權限集合是空的', async () => {
  mockApi({
    'POST /auth/refresh': () => ok({ accessToken: 't' }),
    'GET /auth/me': () => ok(AGENT),
  });
  const probe = renderProvider();
  await waitFor(() => assert.equal(probe.auth.isLoading, false));
  assert.equal(probe.auth.agent?.id, 'a1', '恢復登入狀態成功');
  assert.ok(api.get.mock.calls.some(([url]) => url === '/auth/me/permissions'), '有嘗試載入權限');
  assert.equal(probe.auth.permissions.size, 0);
  assert.equal(probe.canViewAnalytics, false);
});
