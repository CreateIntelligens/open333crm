/**
 * 成員連線後的房間處理（主規格 socket-room-authorization）。
 * 授權本身由 socket-room-authorization.test.ts 驗證；這裡驗證授權結果如何決定加入或離開房間，以及訂閱次數的限制。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { registerRoomHandlers } from '#src/modules/socket/socket-room-handlers.js';
import type { SocketRoomAuthorizationResult } from '#src/modules/socket/socket-room-authorization.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const agentId = '33333333-3333-4333-8333-333333333333';
const conversationRoom = 'conversation:77777777-7777-4777-8777-777777777777';

type Listener = (input: unknown, ack?: (response: unknown) => void) => Promise<void>;

function createSocket() {
  const rooms = new Set<string>();
  const listeners = new Map<string, Listener>();
  return {
    rooms,
    join: (room: string) => { rooms.add(room); },
    leave: (room: string) => { rooms.delete(room); },
    on: (event: string, listener: Listener) => { listeners.set(event, listener); },
    /** 送出事件，等 handler 跑完，回傳 ack 收到的內容 */
    async emit(event: 'subscribe' | 'unsubscribe', input: unknown): Promise<unknown> {
      let response: unknown;
      await listeners.get(event)!(input, (r) => { response = r; });
      return response;
    },
  };
}

function createLog() {
  const warns: string[] = [];
  return { warns, info: () => {}, warn: (_obj: object, msg: string) => { warns.push(msg); } };
}

const allow = async (): Promise<SocketRoomAuthorizationResult> => ({ ok: true, room: conversationRoom });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('連線後加入自己的租戶與成員房間', () => {
  const socket = createSocket();
  registerRoomHandlers(socket, { agentId, tenantId }, allow, createLog());
  assert.deepEqual([...socket.rooms].sort(), [`agent:${agentId}`, `tenant:${tenantId}`]);
});

test('不認得的房間名稱：授權回 INVALID_TARGET 時不加入房間', async () => {
  const socket = createSocket();
  registerRoomHandlers(socket, { agentId, tenantId }, async () => ({ ok: false, code: 'INVALID_TARGET' }), createLog());
  const before = [...socket.rooms];

  const response = await socket.emit('subscribe', 'tenant:arbitrary-room');

  assert.deepEqual(response, { ok: false, code: 'INVALID_TARGET' });
  assert.deepEqual([...socket.rooms], before);
});

test('訂閱房間的授權：授權回 FORBIDDEN 時不加入房間', async () => {
  const socket = createSocket();
  registerRoomHandlers(socket, { agentId, tenantId }, async () => ({ ok: false, code: 'FORBIDDEN' }), createLog());
  const before = [...socket.rooms];

  const response = await socket.emit('subscribe', conversationRoom);

  assert.deepEqual(response, { ok: false, code: 'FORBIDDEN' });
  assert.deepEqual([...socket.rooms], before);
});

test('以物件格式訂閱：授權通過時加入房間並回傳房間名稱', async () => {
  const socket = createSocket();
  const inputs: unknown[] = [];
  registerRoomHandlers(socket, { agentId, tenantId }, async (input) => { inputs.push(input); return allow(); }, createLog());
  const input = { type: 'conversation', id: '77777777-7777-4777-8777-777777777777' };

  const response = await socket.emit('subscribe', input);

  assert.deepEqual(inputs, [input], '原樣交給授權');
  assert.deepEqual(response, { ok: true, room: conversationRoom });
  assert.equal(socket.rooms.has(conversationRoom), true);
});

test('取消訂閱：授權通過時離開房間', async () => {
  const socket = createSocket();
  registerRoomHandlers(socket, { agentId, tenantId }, allow, createLog());
  await socket.emit('subscribe', conversationRoom);

  const response = await socket.emit('unsubscribe', conversationRoom);

  assert.deepEqual(response, { ok: true, room: conversationRoom });
  assert.equal(socket.rooms.has(conversationRoom), false);
});

test('超過訂閱次數：第 61 次回 RATE_LIMITED、寫 warn 日誌、不檢查授權也不加入房間', async () => {
  const socket = createSocket();
  const log = createLog();
  let authorizeCalls = 0;
  registerRoomHandlers(socket, { agentId, tenantId }, async () => { authorizeCalls += 1; return allow(); }, log);
  // subscribe 與 unsubscribe 共用計數：30 次訂閱加 30 次取消，房間最後不在
  for (let i = 0; i < 30; i += 1) {
    await socket.emit('subscribe', conversationRoom);
    await socket.emit('unsubscribe', conversationRoom);
  }
  assert.equal(authorizeCalls, 60);

  const response = await socket.emit('subscribe', conversationRoom);

  assert.deepEqual(response, { ok: false, code: 'RATE_LIMITED' });
  assert.equal(authorizeCalls, 60, '超過次數時不檢查授權');
  assert.equal(socket.rooms.has(conversationRoom), false);
  assert.deepEqual(log.warns, ['Socket subscription rate limit exceeded']);
});

test('計算區間結束後恢復：60 秒後依授權結果處理', async () => {
  const socket = createSocket();
  registerRoomHandlers(socket, { agentId, tenantId }, allow, createLog());
  for (let i = 0; i < 60; i += 1) await socket.emit('unsubscribe', conversationRoom);
  assert.deepEqual(await socket.emit('subscribe', conversationRoom), { ok: false, code: 'RATE_LIMITED' });

  vi.advanceTimersByTime(60_000);

  assert.deepEqual(await socket.emit('subscribe', conversationRoom), { ok: true, room: conversationRoom });
  assert.equal(socket.rooms.has(conversationRoom), true);
});
