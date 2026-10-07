/**
 * 訪客 socket 的 `/visitor` 命名空間：連線次數限制（主規格 webchat-public-abuse-controls），
 * 以及驗證後加入的房間（主規格 webchat-widget）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { registerVisitorNamespace } from '#src/modules/webchat/webchat.socket.js';

type Middleware = (socket: FakeSocket, next: (err?: Error) => void) => void | Promise<void>;
type ConnectionHandler = (socket: FakeSocket) => void;

interface FakeSocket {
  handshake: { address: string; auth: Record<string, unknown>; headers: Record<string, string> };
  data: Record<string, unknown>;
  rooms: Set<string>;
  join: (room: string) => void;
  on: (event: string, handler: () => void) => void;
}

const SESSION = {
  id: 'session-1',
  tenantId: 'tenant-1',
  channelId: '11111111-1111-4111-8111-111111111111',
  conversationId: 'conversation-1',
  visitorToken: '33333333-3333-4333-8333-333333333333',
};

function setup(verify: (input: { sessionId: string; claimToken: string }) => Promise<unknown>) {
  let middleware: Middleware | undefined;
  let onConnection: ConnectionHandler | undefined;
  const namespace = {
    use: (fn: Middleware) => {
      middleware = fn;
      return namespace;
    },
    on: (event: string, fn: ConnectionHandler) => {
      if (event === 'connection') onConnection = fn;
      return namespace;
    },
  };
  const verifier = { verify: vi.fn(verify) };
  registerVisitorNamespace({ of: () => namespace } as never, {} as never, verifier as never);
  assert.ok(middleware && onConnection);

  /** 模擬 Socket.IO：中介層放行才觸發 connection */
  async function connect(address: string, auth: Record<string, unknown>) {
    const socket: FakeSocket = {
      handshake: { address, auth, headers: { 'user-agent': 'Chrome' } },
      data: {},
      rooms: new Set(),
      join: (room) => socket.rooms.add(room),
      on: () => undefined,
    };
    const error = await new Promise<Error | undefined>((resolve) => {
      void middleware!(socket, resolve);
    });
    if (!error) onConnection!(socket);
    return { socket, error };
  }

  return { verifier, connect };
}

const VALID_AUTH = { sessionId: 'cb2.session', claimToken: 'claim-token' };

test('同一個來源 IP 的訪客 socket 連線超過上限：拒絕連線，不驗證工作階段', async () => {
  const { verifier, connect } = setup(async () => SESSION);

  let accepted = 0;
  let rejected: Error | undefined;
  for (let i = 0; i < 200 && !rejected; i += 1) {
    const { error } = await connect('10.20.0.1', VALID_AUTH);
    if (error) rejected = error;
    else accepted += 1;
  }

  assert.ok(rejected, '同一個 IP 的連線要被拒絕');
  assert.equal(rejected.message, 'Too many visitor socket connections');
  assert.equal(verifier.verify.mock.calls.length, accepted);

  const other = await connect('10.20.0.2', VALID_AUTH);
  assert.equal(other.error, undefined, '其他 IP 不受影響');
});

test('Verified socket joins the session room：房間以工作階段紀錄的值組成，不採用 auth 帶來的 channelId 與 visitorToken', async () => {
  const { verifier, connect } = setup(async () => SESSION);

  const { socket, error } = await connect('10.20.1.1', {
    ...VALID_AUTH,
    channelId: '99999999-9999-4999-8999-999999999999',
    visitorToken: '88888888-8888-4888-8888-888888888888',
  });

  assert.equal(error, undefined);
  assert.equal(verifier.verify.mock.calls[0]![0].claimToken, 'claim-token');
  assert.ok(socket.rooms.has(`visitor:${SESSION.channelId}:${SESSION.visitorToken}`));
  assert.equal([...socket.rooms].some((room) => room.includes('9999') || room.includes('8888')), false);
});

test('Visitor Socket.IO auth fails：沒有 sessionId 或 claim token、或驗證失敗時拒絕連線，不加入任何房間', async () => {
  const { verifier, connect } = setup(async () => {
    throw new Error('claim token mismatch');
  });

  const missingClaim = await connect('10.20.2.1', { sessionId: 'cb2.session' });
  const legacyToken = await connect('10.20.2.2', {
    visitorToken: SESSION.visitorToken,
    channelId: SESSION.channelId,
  });
  assert.equal(missingClaim.error?.message, 'Secure Chatbox session required');
  assert.equal(legacyToken.error?.message, 'Secure Chatbox session required');
  assert.equal(verifier.verify.mock.calls.length, 0);

  const failed = await connect('10.20.2.3', VALID_AUTH);
  assert.equal(failed.error?.message, 'Auth failed');

  for (const { socket } of [missingClaim, legacyToken, failed]) {
    assert.equal(socket.rooms.size, 0);
  }
});
