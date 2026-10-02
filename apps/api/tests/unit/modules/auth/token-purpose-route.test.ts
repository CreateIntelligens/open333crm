/**
 * 客服 API 只接受 access token、換發只接受 refresh token（change fix-agent-token-purpose，AUDIT AUTH-05）。
 * 走真實的 auth.plugin 與 /auth/refresh。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, test } from 'vitest';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-token-purpose-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

const { default: cookie } = await import('@fastify/cookie');
const { default: authPlugin } = await import('#src/plugins/auth.plugin.js');
const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
const { default: authRoutes } = await import('#src/modules/auth/auth.routes.js');
const { loadEnvConfig } = await import('#src/config/env.js');
const { memBindingStore } = await import('#tests/support/mem-binding-store.js');

const agentRow = { id: 'a1', tenantId: 't1', email: 'a@x.dev', name: 'A', role: 'ADMIN', roleId: null, avatarUrl: null };
const claims = { agentId: 'a1', tenantId: 't1', role: 'ADMIN', roleId: null };
let app: FastifyInstance;

beforeAll(async () => {
  loadEnvConfig();
  app = Fastify();
  const prisma = { agent: { findFirst: async () => agentRow } };
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', prisma as never);
  await app.register(cookie);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1/auth', loginAttempts: memBindingStore() });
  app.get('/probe', { preHandler: [app.authenticate] }, async (req) => ({ agentId: req.agent.id }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const probe = (token: string) => app.inject({ method: 'GET', url: '/probe', headers: { authorization: `Bearer ${token}` } });
const refresh = (token: string) => app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { refreshToken: token } });

test('access token：通過驗證', async () => {
  const res = await probe(app.jwt.sign({ ...claims, typ: 'access' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().agentId, 'a1');
});

test('refresh token 當 access token：401', async () => {
  assert.equal((await probe(app.jwt.sign({ ...claims, typ: 'refresh', rememberMe: true }))).statusCode, 401);
  assert.equal((await probe(app.jwt.sign({ ...claims, rememberMe: true }))).statusCode, 401, '舊格式 refresh token');
});

test('粉絲 token 與 MCP 確認 token：401', async () => {
  assert.equal((await probe(app.jwt.sign({ sub: 'fan', contactId: 'c1', tenantId: 't1' } as never))).statusCode, 401);
  assert.equal((await probe(app.jwt.sign({ op: 'line.send', tenantId: 't1', agentId: 'a1', v: 1 } as never))).statusCode, 401);
});

test('舊格式 access token（沒有 typ）：401，讓前端換發', async () => {
  assert.equal((await probe(app.jwt.sign(claims))).statusCode, 401);
});

test('換發：cookie 放的是 access token → 401', async () => {
  assert.equal((await refresh(app.jwt.sign({ ...claims, typ: 'access' }))).statusCode, 401);
  assert.equal((await refresh(app.jwt.sign(claims))).statusCode, 401, '舊格式 access token 也不能換發');
});

test('換發：舊格式 refresh token 可換發，新 token 帶用途', async () => {
  const res = await refresh(app.jwt.sign({ ...claims, rememberMe: true }));
  assert.equal(res.statusCode, 200);
  const access = app.jwt.decode<{ typ?: string }>(res.json().data.accessToken);
  assert.equal(access?.typ, 'access');
  const cookie = res.cookies.find((c) => c.name === 'refreshToken');
  assert.equal(app.jwt.decode<{ typ?: string }>(cookie!.value)?.typ, 'refresh');
  assert.equal((await probe(res.json().data.accessToken)).statusCode, 200, '換發後的 access token 可用');
});
