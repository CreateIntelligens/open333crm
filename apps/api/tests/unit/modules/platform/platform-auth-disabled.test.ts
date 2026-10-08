/**
 * 沒有設定 PLATFORM_JWT_SECRET 時，平台後台停用（主規格 platform-auth「沒有設定 PLATFORM_JWT_SECRET 時停用平台後台」）。
 * 設定在載入時讀取一次，所以和有設定的情境分成不同的測試檔。
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

let app: FastifyInstance;

beforeAll(async () => {
  loadEnvConfig();
  app = Fastify();
  const prisma = { platformUser: { findUnique: async () => null } };
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', prisma as never);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

test('沒有設定 PLATFORM_JWT_SECRET：登入與需要登入的平台路由都回 503 PLATFORM_DISABLED', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/auth/login',
    payload: { email: 'ops@example.com', password: 'whatever-password' },
  });
  const plans = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/plans',
    headers: { authorization: 'Bearer any-token' },
  });

  for (const res of [login, plans]) {
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(res.json().error.code, 'PLATFORM_DISABLED');
  }
});
