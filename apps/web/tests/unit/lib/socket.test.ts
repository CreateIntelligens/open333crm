/**
 * socket 重連使用最新的 access token；被伺服器以驗證失敗拒絕時先換發再重連（change fix-agent-token-purpose）。
 * 原本建立連線時把 token 固定在設定裡，access token 15 分鐘過期後、API 重啟（部署）就再也連不上。
 *
 * 這裡用假的 socket，手動設定 active。真實行為依 socket.io-client 4.8.3 原始碼確認：伺服器 middleware 拒絕連線時
 * 走 CONNECT_ERROR，先 destroy()（subs 清空 → active 為 false）再發 connect_error；網路錯誤時 active 仍為 true，
 * 由 socket.io 自己重試。升級 socket.io-client 時要重新確認。
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

test('換發途中使用者登出（連線已被關閉）：不再把舊連線連回去', async () => {
  let release!: () => void;
  getSocket({ getToken: () => null, onAuthError: () => new Promise<void>((r) => { release = r; }) });
  const pending = fake.fire('connect_error', new Error('登入已過期，請重新登入'));
  disconnectSocket();
  release();
  await pending;
  assert.equal(fake.connectCalls, 0);
});

test('重試用完仍連不上：通知呼叫端顯示連線中斷', async () => {
  let gaveUp = 0;
  getSocket({ getToken: () => 't', onAuthError: async () => {}, onGiveUp: () => { gaveUp++; } });
  for (let i = 0; i < 3; i++) await fake.fire('connect_error', new Error('x'));
  assert.equal(gaveUp, 0);
  await fake.fire('connect_error', new Error('x'));
  assert.equal(gaveUp, 1);
});
