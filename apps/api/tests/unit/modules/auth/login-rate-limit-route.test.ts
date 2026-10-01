/**
 * 登入依來源 IP 限流，429 回應可讀（change add-login-brute-force-protection，AUDIT SEC-05）。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { test } from 'vitest';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-login-rate-limit-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
import authPlugin from '#src/plugins/auth.plugin.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import authRoutes from '#src/modules/auth/auth.routes.js';
import { loadEnvConfig } from '#src/config/env.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

test('同一 IP 一分鐘內第 11 次登入回 429 RATE_LIMITED，訊息可讀', async () => {
  const prisma = { agent: { findUnique: async () => null } };
  const app = Fastify();
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', prisma as never);
  loadEnvConfig();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1/auth', loginAttempts: memBindingStore() });

  const statuses: number[] = [];
  let last: { error?: { code?: string; message?: string } } = {};
  for (let i = 0; i < 11; i++) {
    // 每次用不同 email，避開帳號鎖定，只測 IP 限流
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `u${i}@x.dev`, password: 'whatever-1' },
    });
    statuses.push(res.statusCode);
    last = res.json();
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
  assert.equal(last.error?.code, 'RATE_LIMITED');
  assert.equal(last.error?.message, '操作太頻繁，請稍候再試');
  await app.close();
});
