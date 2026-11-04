/**
 * API 金鑰與 CLI token 的有效天數（change settings-input-validation-and-credential-audit，
 * partner-api-key「API 金鑰的有效天數」、open333-cli-auth「CLI token expiry from the settings page is bounded」）。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。每次執行建立一個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';

// 建立金鑰與 token 時以 bcrypt 雜湊
vi.setConfig({ testTimeout: 20_000 });

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-credential-expiry-${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const role = await owner.role.create({
  data: { tenantId: T, slug: MARK, name: MARK, permissions: { create: [{ permissionCode: 'settings.manage' }] } },
});
const agent = await owner.agent.create({
  data: { tenantId: T, roleId: role.id, name: 'admin', email: `${MARK}@example.test`, passwordHash: 'x' },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
});
await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
await app.ready();

afterAll(async () => {
  await app.close();
  await owner.cliSession.deleteMany({ where: { tenantId: T } });
  await owner.partnerApiKey.deleteMany({ where: { tenantId: T } });
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function post(url: string, payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: `/api/v1/settings/${url}`, payload });
  return { status: res.statusCode, body: res.json() };
}

/** 到期時間在「建立前後的時間 + days 天」之間 */
function assertExpiresAfterDays(expiresAt: string, before: number, days: number) {
  const at = new Date(expiresAt).getTime();
  assert.ok(at >= before + days * DAY_MS && at <= Date.now() + days * DAY_MS, `${expiresAt} 應為 ${days} 天後`);
}

const OUT_OF_RANGE = [0, 366, 3650000, 1.5];

describe('API 金鑰的有效天數', () => {
  test('最大的有效天數可以建立', async () => {
    const before = Date.now();
    const res = await post('api-keys', { name: `${MARK}-max`, expiresInDays: 365 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertExpiresAfterDays(res.body.data.expiresAt, before, 365);
  });

  test('沒有指定有效天數時永不過期', async () => {
    for (const payload of [{}, { expiresInDays: null }]) {
      const res = await post('api-keys', { name: `${MARK}-never`, ...payload });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.expiresAt, null);
    }
  });

  test('有效天數超出範圍', async () => {
    for (const expiresInDays of OUT_OF_RANGE) {
      const name = `${MARK}-bad-${expiresInDays}`;
      const res = await post('api-keys', { name, expiresInDays });
      assert.equal(res.status, 400, `${expiresInDays}：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(res.body.error.details.issues.map((i: { path: string }) => i.path), ['expiresInDays']);
      assert.equal(await owner.partnerApiKey.count({ where: { tenantId: T, name } }), 0);
    }
  });
});

describe('CLI token expiry from the settings page is bounded', () => {
  test('Maximum expiry is accepted', async () => {
    const before = Date.now();
    const res = await post('cli-sessions', { name: `${MARK}-max`, expiresInDays: 365 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertExpiresAfterDays(res.body.data.session.expiresAt, before, 365);
  });

  test('Expiry is not sent', async () => {
    for (const payload of [{}, { expiresInDays: null }]) {
      const before = Date.now();
      const res = await post('cli-sessions', { name: `${MARK}-default`, ...payload });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assertExpiresAfterDays(res.body.data.session.expiresAt, before, 30);
    }
  });

  test('Expiry is out of range', async () => {
    for (const expiresInDays of OUT_OF_RANGE) {
      const name = `${MARK}-bad-${expiresInDays}`;
      const res = await post('cli-sessions', { name, expiresInDays });
      assert.equal(res.status, 400, `${expiresInDays}：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(res.body.error.details.issues.map((i: { path: string }) => i.path), ['expiresInDays']);
      assert.equal(await owner.cliSession.count({ where: { tenantId: T, name } }), 0);
    }
  });
});
