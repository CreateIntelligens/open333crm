/**
 * API 的一般用途 Redis 連線（change unify-redis-connection-api：redis-connection
 * 「建立 API 應用程式時不連 Redis」「關閉 API 應用程式時關閉一般用途的連線」）。
 *
 * 全域的假 Redis（tests/setup/unit.setup.ts）永遠回報狀態 `end`，分不出「還沒連線」與「已關閉」，
 * 所以這個檔案換回真的 ioredis，連到一個沒有程式監聽的 port。
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import Fastify from 'fastify';
import { beforeAll, test, vi } from 'vitest';

vi.mock('ioredis', async (importOriginal) => importOriginal());

const config = vi.hoisted(() => ({ REDIS_URL: '' }));
vi.mock('#src/config/env.js', () => ({ getConfig: () => config }));

const { default: redisPlugin } = await import('#src/plugins/redis.plugin.js');

beforeAll(async () => {
  // 取得一個空的 port 之後關閉，之後連到這個 port 會被拒絕
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  config.REDIS_URL = `redis://127.0.0.1:${(probe.address() as net.AddressInfo).port}`;
  await new Promise((resolve) => probe.close(resolve));
});

test('Redis 無法使用時建立 API 應用程式：載入成功，連線尚未開始', async () => {
  const app = Fastify();
  await app.register(redisPlugin);
  await app.ready();
  try {
    assert.ok(app.redis, '沒有 fastify.redis');
    assert.equal(app.redis.status, 'wait');
  } finally {
    await app.close();
  }
});

test('關閉 API 應用程式：連線已關閉，之後的指令以錯誤結束', async () => {
  const app = Fastify();
  await app.register(redisPlugin);
  await app.ready();
  const redis = app.redis;
  await app.close();

  assert.ok(redis, '沒有 fastify.redis');
  assert.equal(redis.status, 'end');
  await assert.rejects(redis.get('k'));
});
