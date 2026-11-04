/**
 * workers 的兩條 Redis 連線依用途設定（主規格 redis-connection）：
 * 發布 socket 事件是一般指令，Redis 不回應時在 1 秒內失敗；BullMQ 的連線繼續等待。
 *
 * 不需要 Redis：連到一個接受 TCP 連線、但不回傳任何資料的 net server。
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, test } from 'vitest';
import { createWorkerRedis, type WorkerRedis } from '#src/lib/redis.js';

let silentServer: net.Server;
let silentUrl: string;
const sockets = new Set<net.Socket>();
const created: WorkerRedis[] = [];

beforeAll(async () => {
  silentServer = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
  silentUrl = `redis://127.0.0.1:${(silentServer.address() as net.AddressInfo).port}`;
});

afterEach(() => {
  for (const { connection, publisher } of created.splice(0)) {
    connection.disconnect();
    publisher.disconnect();
  }
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => silentServer.close(resolve));
});

function create(): WorkerRedis {
  const redis = createWorkerRedis(silentUrl);
  created.push(redis);
  return redis;
}

/** 執行 PUBLISH，回傳等待的毫秒數與結果；超過 waitMs 仍未結束時回傳 pending */
async function timePublish(client: Redis, waitMs: number) {
  const started = Date.now();
  const outcome = await Promise.race([
    client.publish('socket:emit', '{}').then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), waitMs)),
  ]);
  return { outcome, elapsedMs: Date.now() - started };
}

test('Redis 接受連線但不回應：發布 socket 事件在 1 秒內失敗', async () => {
  const { outcome, elapsedMs } = await timePublish(create().publisher, 3000);
  assert.equal(outcome, 'rejected');
  // 計時器的觸發會晚幾毫秒，所以上限多留 100 毫秒
  assert.ok(elapsedMs < 1100, `等了 ${elapsedMs} 毫秒`);
});

test('Redis 不回應時指令繼續等待：BullMQ 的連線經過 1.5 秒仍在等待', async () => {
  const { outcome } = await timePublish(create().connection, 1500);
  assert.equal(outcome, 'pending');
});
