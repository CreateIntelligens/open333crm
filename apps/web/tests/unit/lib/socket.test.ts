/**
 * socket 重連使用最新的 access token；被伺服器以驗證失敗拒絕時先換發再重連（change fix-agent-token-purpose）。
 * 原本建立連線時把 token 固定在設定裡，access token 15 分鐘過期後、API 重啟（部署）就再也連不上。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

type Handler = (arg?: unknown) => unknown;
const fake = {
  handlers: new Map<string, Handler[]>(),
  options: undefined as undefined | { auth: (cb: (data: { token: string | null }) => void) => void },
  active: false,
  connected: false,
  connectCalls: 0,
  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
    return this;
  },
  async fire(event: string, arg?: unknown) {
    for (const h of this.handlers.get(event) ?? []) await h(arg);
  },
  connect() {
    this.connectCalls++;
  },
  disconnect() {},
};
vi.mock('socket.io-client', () => ({
  io: (_url: unknown, options: typeof fake.options) => {
    fake.options = options;
    return fake;
  },
}));

const { getSocket, disconnectSocket } = await import('#src/lib/socket.js');

beforeEach(() => {
  disconnectSocket();
  fake.handlers.clear();
  fake.connectCalls = 0;
  fake.active = false;
});

test('每次連線（含重連）都讀當下最新的 access token', () => {
  let token = 'old-token';
  getSocket({ getToken: () => token, onAuthError: async () => {} });
  const read = () => {
    let got: string | null = null;
    fake.options!.auth((d) => (got = d.token));
    return got;
  };
  assert.equal(read(), 'old-token');
  token = 'new-token';
  assert.equal(read(), 'new-token', '換發後重連要用新的 token');
});

test('伺服器以驗證失敗拒絕：先換發再重連，連續最多 3 次', async () => {
  let refreshes = 0;
  getSocket({ getToken: () => 't', onAuthError: async () => { refreshes++; } });
  for (let i = 0; i < 5; i++) await fake.fire('connect_error', new Error('登入已過期，請重新登入'));
  assert.equal(refreshes, 3);
  assert.equal(fake.connectCalls, 3);
});

test('連上之後重新計算重試次數', async () => {
  getSocket({ getToken: () => 't', onAuthError: async () => {} });
  for (let i = 0; i < 3; i++) await fake.fire('connect_error', new Error('x'));
  await fake.fire('connect');
  await fake.fire('connect_error', new Error('x'));
  assert.equal(fake.connectCalls, 4);
});

test('連線還在自動重試中（網路斷線等）：不介入', async () => {
  let refreshes = 0;
  getSocket({ getToken: () => 't', onAuthError: async () => { refreshes++; } });
  fake.active = true;
  await fake.fire('connect_error', new Error('xhr poll error'));
  assert.equal(refreshes, 0);
  assert.equal(fake.connectCalls, 0);
});
