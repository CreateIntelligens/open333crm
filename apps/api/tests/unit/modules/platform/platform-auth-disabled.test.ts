/**
 * 沒有設定 PLATFORM_JWT_SECRET 時，平台後台停用（主規格 platform-auth「沒有設定 PLATFORM_JWT_SECRET 時停用平台後台」）。
 * 設定在載入時讀取一次，所以和有設定的情境分成不同的測試檔。
 * 平台路由的清單由 onRoute 收集，之後新增的平台路由也會被檢查。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-platform-disabled-tenant-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
delete process.env.PLATFORM_JWT_SECRET;

import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, test } from 'vitest';

const { default: authPlugin } = await import('#src/plugins/auth.plugin.js');
const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
const { default: platformRoutes } = await import('#src/modules/platform/platform.routes.js');
const { loadEnvConfig } = await import('#src/config/env.js');

const PREFIX = '/api/v1/platform';
/** 不需要 token 的平台路由。忘記密碼與重設密碼不檢查 PLATFORM_JWT_SECRET，不在這個需求的範圍內 */
const PUBLIC = ['POST /auth/login', 'POST /auth/forgot-password', 'POST /auth/reset-password'];
const ID = '55555555-5555-4555-8555-555555555555';

let app: FastifyInstance;
const routes: string[] = [];

beforeAll(async () => {
  loadEnvConfig();
  app = Fastify();
  const prisma = { platformUser: { findUnique: async () => null } };
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', prisma as never);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith(PREFIX)) return;
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') routes.push(`${method} ${route.url.slice(PREFIX.length)}`);
    }
  });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(platformRoutes, { prefix: PREFIX });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

test('沒有設定 PLATFORM_JWT_SECRET：登入與每一條需要登入的平台路由都回 503 PLATFORM_DISABLED，不帶 token 也一樣', async () => {
  const login = await app.inject({
    method: 'POST',
    url: `${PREFIX}/auth/login`,
    payload: { email: 'ops@example.com', password: 'whatever-password' },
  });
  assert.equal(login.statusCode, 503, login.body);
  assert.equal(login.json().error.code, 'PLATFORM_DISABLED');

  const guarded = routes.filter((r) => !PUBLIC.includes(r));
  assert.ok(guarded.includes('GET /plans'), '沒有收集到平台路由');
  const wrong: string[] = [];
  for (const route of guarded) {
    const [method, path] = route.split(' ') as [string, string];
    const res = await app.inject({ method: method as never, url: PREFIX + path.replace(/:[A-Za-z]+/g, ID) });
    if (res.statusCode !== 503 || res.json().error?.code !== 'PLATFORM_DISABLED') wrong.push(`${route} → ${res.statusCode} ${res.body}`);
  }
  assert.deepEqual(wrong, []);
});
