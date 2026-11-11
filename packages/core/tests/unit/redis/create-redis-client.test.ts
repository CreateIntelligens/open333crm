/**
 * 建立 Redis 連線的兩種用途（change unify-redis-connection-api：redis-connection）。
 *
 * 不需要 Redis：「拒絕連線」連到一個沒有程式監聽的 port，「不回應」連到一個接受 TCP 連線、
 * 但不回傳任何資料的 net server。「交給 BullMQ 的 Worker」需要真的 Redis，見
 * apps/api/tests/feature/lib/redis-connection.test.ts。
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, test } from 'vitest';
import { createRedisClient } from '#src/redis/create-client.js';

let silentServer: net.Server;
let silentUrl: string;
let closedUrl: string;
const sockets = new Set<net.Socket>();
const clients: Redis[] = [];

function portOf(server: net.Server): number {
  return (server.address() as net.AddressInfo).port;
}

function listen(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

beforeAll(async () => {
  silentServer = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await listen(silentServer);
  silentUrl = `redis://127.0.0.1:${portOf(silentServer)}`;

  // 取得一個空的 port 之後關閉，之後連到這個 port 會被拒絕
  const probe = net.createServer();
  await listen(probe);
  closedUrl = `redis://127.0.0.1:${portOf(probe)}`;
  await new Promise((resolve) => probe.close(resolve));
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => silentServer.close(resolve));
});

function create(url: string, purpose: 'command' | 'queue'): Redis {
  const client = createRedisClient(url, purpose);
  clients.push(client);
  return client;
}

/** 執行 GET，回傳等待的毫秒數與結果；超過 waitMs 仍未結束時回傳 pending */
async function timeGet(client: Redis, waitMs: number) {
  const started = Date.now();
  const outcome = await Promise.race([
    client.get('k').then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), waitMs)),
  ]);
  return { outcome, elapsedMs: Date.now() - started };
}

// 計時器的觸發會晚幾毫秒，所以上限多留 100 毫秒
const LIMIT_MS = 1000 + 100;

test('Redis 拒絕連線：一般用途的 GET 在 1 秒內失敗', async () => {
  const { outcome, elapsedMs } = await timeGet(create(closedUrl, 'command'), 5000);
  assert.equal(outcome, 'rejected');
  assert.ok(elapsedMs < LIMIT_MS, `等了 ${elapsedMs} 毫秒`);
});

test('Redis 接受連線但不回應：一般用途的 GET 在 1 秒內失敗', async () => {
  const { outcome, elapsedMs } = await timeGet(create(silentUrl, 'command'), 5000);
  assert.equal(outcome, 'rejected');
  assert.ok(elapsedMs < LIMIT_MS, `等了 ${elapsedMs} 毫秒`);
});

test('Redis 不回應時指令繼續等待：BullMQ 用途的 GET 經過 1.5 秒仍在等待', async () => {
  const { outcome } = await timeGet(create(silentUrl, 'queue'), 1500);
  assert.equal(outcome, 'pending');
});
