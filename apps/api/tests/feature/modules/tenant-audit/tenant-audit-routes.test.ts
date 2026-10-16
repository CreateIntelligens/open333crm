/**
 * 主規格 tenant-audit-log 的路由情境（change restore-tenant-audit-gdpr-specs）：
 * 設定角色權限時寫稽核、依 action 篩選本租戶的稽核、沒有 audit.view 不能查詢。
 *
 * 走真實的 requirePermission、role.routes、tenant-audit.routes 與 app_tenant 連線（RLS）。
 * 每次執行建立一個專用租戶，結束時整個刪除；租戶 B 的稽核以唯一標記刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import roleRoutes from '#src/modules/role/role.routes.js';
import tenantAuditRoutes from '#src/modules/tenant-audit/tenant-audit.routes.js';
import { TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-audit-routes-${Date.now()}`;

const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;

async function createRole(slug: string, permissions: string[]) {
  return owner.role.create({
    data: {
      tenantId: T,
      slug: `${MARK}-${slug}`,
      name: slug,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

const auditorRole = await createRole('auditor', ['role.view', 'role.manage', 'audit.view', 'tag.view']);
const plainRole = await createRole('plain', ['role.view']);
const targetRole = await createRole('target', []);
const auditor = await owner.agent.create({
  data: { tenantId: T, roleId: auditorRole.id, email: `${MARK}-auditor@example.test`, name: '稽核者', passwordHash: 'x' },
});
const plain = await owner.agent.create({
  data: { tenantId: T, roleId: plainRole.id, email: `${MARK}-plain@example.test`, name: '一般成員', passwordHash: 'x' },
});
// 租戶 B 的同名 action 稽核：查詢結果不能含這一筆
const foreignLog = await owner.tenantAuditLog.create({
  data: { tenantId: TENANT_B, action: 'role.permission.update', targetType: 'role', payload: { mark: MARK } },
});

async function buildApp(agent: { id: string; roleId: string | null }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: T, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
  });
  await app.register(roleRoutes, { prefix: '/api/v1/roles' });
  await app.register(tenantAuditRoutes, { prefix: '/api/v1/tenant/audit-logs' });
  await app.ready();
  return app;
}

const auditorApp = await buildApp(auditor);
const plainApp = await buildApp(plain);

afterAll(async () => {
  await Promise.all([auditorApp.close(), plainApp.close()]);
  await owner.tenantAuditLog.deleteMany({ where: { id: foreignLog.id } });
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

test('設定角色權限時寫稽核', async () => {
  const res = await auditorApp.inject({
    method: 'PUT',
    url: `/api/v1/roles/${targetRole.id}/permissions`,
    payload: { permissions: ['tag.view'] },
  });
  assert.equal(res.statusCode, 200, res.body);

  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: T, action: 'role.permission.update' } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].targetType, 'role');
  assert.equal(logs[0].targetId, targetRole.id);
  assert.equal(logs[0].actorId, auditor.id);
  assert.deepEqual((logs[0].payload as { permissions: string[] }).permissions, ['tag.view']);
});

test('依 action 篩選本租戶的稽核', async () => {
  await owner.tenantAuditLog.create({ data: { tenantId: T, actorId: auditor.id, action: 'settings.update' } });
  const res = await auditorApp.inject({
    method: 'GET',
    url: '/api/v1/tenant/audit-logs?action=role.permission.update',
  });
  assert.equal(res.statusCode, 200, res.body);
  const { rows, total } = res.json().data as { rows: Array<{ id: string; action: string }>; total: number };
  assert.ok(rows.length > 0, '本租戶有 role.permission.update 的稽核');
  assert.ok(rows.every((r) => r.action === 'role.permission.update'), JSON.stringify(rows));
  assert.ok(!rows.some((r) => r.id === foreignLog.id), '不含租戶 B 的稽核');
  assert.equal(total, rows.length);
});

test('沒有 audit.view 不能查詢', async () => {
  const res = await plainApp.inject({ method: 'GET', url: '/api/v1/tenant/audit-logs' });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'audit.view');
  assert.equal(res.json().data, undefined);
});
