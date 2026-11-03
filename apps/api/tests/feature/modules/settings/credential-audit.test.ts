/**
 * 建立與撤銷 API 金鑰、CLI token 時寫稽核（change settings-input-validation-and-credential-audit，
 * tenant-audit-log「記錄租戶內的敏感操作」的長效憑證）。
 *
 * 設定路由走真實的 requirePermission 與 app_tenant 連線（RLS）；CLI 登入與登出走真實的 auth.plugin。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import authPlugin from '#src/plugins/auth.plugin.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import authRoutes from '#src/modules/auth/auth.routes.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import { DEFAULT_CLI_SCOPES } from '#src/modules/auth/cli-session.service.js';
import { hashPassword } from '#src/shared/utils/password.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

// 建立金鑰與 token 時以 bcrypt 雜湊，CLI 登入另外比對密碼
vi.setConfig({ testTimeout: 20_000 });

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-credential-audit-${Date.now()}`;
const MISSING = '00000000-0000-4000-8000-000000000000';
const PASSWORD = 'Correct-Pass-1';

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;
const B = tenantB.id;

type TestAgent = { id: string; tenantId: string; roleId: string; email: string };
async function makeAgent(tenantId: string): Promise<TestAgent> {
  const role = await owner.role.create({
    data: { tenantId, slug: MARK, name: MARK, permissions: { create: [{ permissionCode: 'settings.manage' }] } },
  });
  const email = `${MARK}-${tenantId}@example.test`;
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, name: 'admin', email, passwordHash: await hashPassword(PASSWORD) },
  });
  return { id: agent.id, tenantId, roleId: role.id, email };
}

async function buildApp(agent: TestAgent) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: agent.tenantId, role: 'ADMIN', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, agent.tenantId);
  });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.ready();
  return app;
}

const agentA = await makeAgent(A);
const agentB = await makeAgent(B);
const appA = await buildApp(agentA);
const appB = await buildApp(agentB);
// 有 settings.manage、但成員不存在：稽核的 actorId 違反外鍵，用來讓稽核寫入失敗
const appGhost = await buildApp({ ...agentA, id: MISSING });

const authApp = Fastify();
authApp.decorate('prisma', tenantDb as never);
authApp.decorate('prismaAdmin', owner as never);
await authApp.register(cookie);
await authApp.register(errorHandlerPlugin);
await authApp.register(authPlugin);
await authApp.register(authRoutes, { prefix: '/api/v1/auth', loginAttempts: memBindingStore() });
await authApp.ready();

afterAll(async () => {
  await Promise.all([appA.close(), appB.close(), appGhost.close(), authApp.close()]);
  for (const tenantId of [A, B]) {
    await owner.cliSession.deleteMany({ where: { tenantId } });
    await owner.partnerApiKey.deleteMany({ where: { tenantId } });
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

beforeEach(async () => {
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: { in: [A, B] } } });
});

type App = typeof appA;
async function call(app: App, method: 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  const res = await app.inject({ method, url: `/api/v1/settings/${url}`, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}
const audits = (tenantId = A) =>
  owner.tenantAuditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { action: true, actorId: true, targetType: true, targetId: true, payload: true, ip: true },
  });
/** 稽核的任何欄位都不含這段明文 */
async function assertNoSecret(secret: string) {
  const rows = await owner.tenantAuditLog.findMany({ where: { tenantId: { in: [A, B] } } });
  assert.ok(!JSON.stringify(rows).includes(secret.slice(4)), '稽核不含明文');
}

describe('API 金鑰', () => {
  test('建立 API 金鑰時寫稽核', async () => {
    const res = await call(appA, 'POST', 'api-keys', { name: `${MARK}-k`, expiresInDays: 30 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { id, expiresAt, key } = res.body.data;
    assert.deepEqual(await audits(), [
      {
        action: 'settings.update',
        actorId: agentA.id,
        targetType: 'settings',
        targetId: null,
        payload: { section: 'api-keys', operation: 'create', apiKeyId: id, name: `${MARK}-k`, expiresAt },
        ip: '127.0.0.1',
      },
    ]);
    await assertNoSecret(key);
  });

  test('撤銷 API 金鑰時寫稽核', async () => {
    const { id } = (await call(appA, 'POST', 'api-keys', { name: `${MARK}-revoke` })).body.data;
    await owner.tenantAuditLog.deleteMany({ where: { tenantId: A } });
    assert.equal((await call(appA, 'DELETE', `api-keys/${id}`)).status, 200);
    const rows = await audits();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'settings.update');
    assert.equal(rows[0].actorId, agentA.id);
    assert.deepEqual(rows[0].payload, { section: 'api-keys', operation: 'revoke', apiKeyId: id });
  });

  test('稽核寫入失敗時，金鑰沒有建立', async () => {
    const name = `${MARK}-ghost`;
    const res = await call(appGhost, 'POST', 'api-keys', { name });
    // error handler 把 Prisma 的外鍵錯誤轉成 400 DATABASE_ERROR
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(await owner.partnerApiKey.count({ where: { tenantId: A, name } }), 0);
  });
});

describe('CLI token（設定頁）', () => {
  test('在設定頁建立 CLI token 時寫稽核', async () => {
    const res = await call(appA, 'POST', 'cli-sessions', { name: `${MARK}-c`, mcpRead: true, expiresInDays: 7 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { token, session } = res.body.data;
    assert.deepEqual(await audits(), [
      {
        action: 'settings.update',
        actorId: agentA.id,
        targetType: 'settings',
        targetId: null,
        payload: {
          section: 'cli-sessions',
          operation: 'create',
          sessionId: session.id,
          name: `${MARK}-c`,
          scopes: session.scopes,
          expiresAt: session.expiresAt,
        },
        ip: '127.0.0.1',
      },
    ]);
    await assertNoSecret(token);
  });

  test('在設定頁撤銷 CLI token 時寫稽核', async () => {
    const { session } = (await call(appA, 'POST', 'cli-sessions', { name: `${MARK}-revoke` })).body.data;
    await owner.tenantAuditLog.deleteMany({ where: { tenantId: A } });
    assert.equal((await call(appA, 'DELETE', `cli-sessions/${session.id}`)).status, 200);
    const rows = await audits();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'settings.update');
    assert.equal(rows[0].actorId, agentA.id);
    assert.deepEqual(rows[0].payload, { section: 'cli-sessions', operation: 'revoke', sessionId: session.id });
  });

  // CLI token 不另寫「稽核寫入失敗」的測試：cli_sessions.agentId 有外鍵，不存在的成員在寫入 token 時就失敗，
  // 測不到稽核。API 金鑰的 createdById 沒有外鍵，上面的測試才會走到稽核
});

describe('CLI 登入與登出', () => {
  test('CLI 登入與登出時寫稽核', async () => {
    const login = await authApp.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/login',
      payload: { email: agentB.email, password: PASSWORD, name: `${MARK}-login` },
    });
    assert.equal(login.statusCode, 200, login.body);
    const { token, session } = login.json().data;
    const logout = await authApp.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(logout.statusCode, 200, logout.body);

    assert.deepEqual(await audits(B), [
      {
        action: 'cli_session.login',
        actorId: agentB.id,
        targetType: 'cli_session',
        targetId: session.id,
        payload: { name: `${MARK}-login`, scopes: [...DEFAULT_CLI_SCOPES], expiresAt: session.expiresAt },
        ip: '127.0.0.1',
      },
      {
        action: 'cli_session.logout',
        actorId: agentB.id,
        targetType: 'cli_session',
        targetId: session.id,
        payload: null,
        ip: '127.0.0.1',
      },
    ]);
    await assertNoSecret(token);
  });
});

describe('撤銷不存在的憑證時不寫稽核', () => {
  // review-loop 第 1 輪：已經撤銷的 CLI token 不再寫稽核，API 金鑰原本仍會再寫一筆
  test('已經撤銷的 API 金鑰與 CLI token 再撤銷一次', async () => {
    const key = (await call(appA, 'POST', 'api-keys', { name: `${MARK}-twice` })).body.data;
    const { session } = (await call(appA, 'POST', 'cli-sessions', { name: `${MARK}-twice` })).body.data;
    assert.equal((await call(appA, 'DELETE', `api-keys/${key.id}`)).status, 200);
    assert.equal((await call(appA, 'DELETE', `cli-sessions/${session.id}`)).status, 200);
    await owner.tenantAuditLog.deleteMany({ where: { tenantId: A } });

    const again = await call(appA, 'DELETE', `api-keys/${key.id}`);
    assert.equal(again.status, 200, '已停用的金鑰再撤銷仍回 200');
    assert.deepEqual(again.body.data, { revoked: true });
    assert.equal((await call(appA, 'DELETE', `cli-sessions/${session.id}`)).status, 200);
    assert.deepEqual(await audits(), []);
  });

  test('不存在的 API 金鑰與 CLI token', async () => {
    assert.equal((await call(appA, 'DELETE', `api-keys/${MISSING}`)).status, 404);
    await call(appA, 'DELETE', `cli-sessions/${MISSING}`);
    assert.deepEqual(await audits(), []);
  });

  test('另一個租戶的 API 金鑰與 CLI token', async () => {
    const key = (await call(appB, 'POST', 'api-keys', { name: `${MARK}-b` })).body.data;
    const { session } = (await call(appB, 'POST', 'cli-sessions', { name: `${MARK}-b` })).body.data;
    await call(appA, 'DELETE', `api-keys/${key.id}`);
    await call(appA, 'DELETE', `cli-sessions/${session.id}`);
    assert.deepEqual(await audits(A), []);
  });
});
