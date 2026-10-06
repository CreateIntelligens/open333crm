/**
 * 主規格 permission-check，以及 rbac 的「Partner API 金鑰只通過白名單權限碼」
 * （change restore-rbac-permission-specs）。
 *
 * 走真實的 requirePermission、權限計算、Redis 快取與 app_tenant 連線。
 * guard 本身的情境掛在測試用的路由上；快取與權限端點走真實的角色路由與 auth 路由。
 * 測試名稱以「情境名稱：說明」開頭。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { redis } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import authPlugin from '#src/plugins/auth.plugin.js';
import { requirePermission, requireAnyPermission } from '#src/guards/rbac.guard.js';
import roleRoutes from '#src/modules/role/role.routes.js';
import authRoutes from '#src/modules/auth/auth.routes.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-perm-check-${Date.now()}`;
const AGENT_ID = '00000000-0000-4000-8000-0000000000aa';
let seq = 0;

type Caller = { roleId?: string | null; tenantId?: string; isPartnerKey?: boolean };

async function createRole(permissions: string[], tenantId = A) {
  seq += 1;
  return owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-${seq}`,
      name: `${MARK}-${seq}`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

/** 掛測試用路由與真實的角色、auth 路由；登入成員由 caller 決定 */
async function buildApp(caller: Caller) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const tenantId = caller.tenantId ?? A;
    request.agent = { id: AGENT_ID, tenantId, role: 'AGENT', ...caller } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
  });
  // auth 路由的 CLI 端點要這兩個 decorator；這裡不測 CLI，只讓路由能註冊
  app.decorate('authenticateCliSession', async () => {});
  app.decorate('authenticateJwtOrCliSession', async () => {});
  await app.register(async (probe) => {
    probe.addHook('preHandler', probe.authenticate);
    const ok = async () => ({ ok: true });
    probe.get('/create', { preHandler: [requirePermission('channel.create')] }, ok);
    probe.get('/any', { preHandler: [requireAnyPermission(['analytics.view', 'analytics.view.self'])] }, ok);
    probe.get('/knowledge-admin', { preHandler: [requirePermission('knowledge.admin')] }, ok);
    probe.get('/knowledge-view', { preHandler: [requirePermission('knowledge.view')] }, ok);
    probe.get('/tag-manage', { preHandler: [requirePermission('tag.manage')] }, ok);
  }, { prefix: '/probe' });
  await app.register(roleRoutes, { prefix: '/api/v1/roles' });
  await app.register(authRoutes, { prefix: '/api/v1/auth', loginAttempts: memBindingStore() });
  await app.ready();
  apps.push(app);
  return app;
}
const apps: Array<{ close: () => Promise<unknown> }> = [];
const asRole = async (permissions: string[]) => buildApp({ roleId: (await createRole(permissions)).id });

// 方案天花板：專用租戶的方案只含 inbox 功能
const plan = await owner.plan.create({ data: { slug: MARK, name: MARK, features: ['inbox'] } });
const planTenant = await owner.tenant.create({ data: { name: MARK, planId: plan.id } });

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: { in: [A, planTenant.id] }, actorId: AGENT_ID } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.tenant.delete({ where: { id: planTenant.id } });
  await owner.plan.delete({ where: { id: plan.id } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

// ── 權限檢查 guard ──

test('有權限碼的成員通過：有 channel.create 時進入路由處理', async () => {
  const res = await (await asRole(['channel.view', 'channel.create'])).inject({ method: 'GET', url: '/probe/create' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { ok: true });
});

test('沒有權限碼的成員被拒：回 403 FORBIDDEN，details.requiredPermission 是 channel.create', async () => {
  const res = await (await asRole(['channel.view'])).inject({ method: 'GET', url: '/probe/create' });
  assert.equal(res.statusCode, 403, res.body);
  const body = res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.ok(body.error.message);
  assert.deepEqual(body.error.details, { requiredPermission: 'channel.create' });
});

test('未登入時回 401：guard 排在 authenticate 之後，不回 403', async () => {
  const app = Fastify();
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  app.get('/probe/create', { preHandler: [app.authenticate, requirePermission('channel.create')] }, async () => ({ ok: true }));
  await app.ready();
  apps.push(app);
  const res = await app.inject({ method: 'GET', url: '/probe/create' });
  assert.equal(res.statusCode, 401, res.body);
});

// ── 任一權限碼即可通過 ──

test('只有其中一個權限碼也通過：只有 analytics.view.self', async () => {
  const res = await (await asRole(['analytics.view.self'])).inject({ method: 'GET', url: '/probe/any' });
  assert.equal(res.statusCode, 200, res.body);
});

test('一個權限碼都沒有時被拒：回 403，details.requiredAnyOf 列出兩個碼', async () => {
  const res = await (await asRole(['tag.view'])).inject({ method: 'GET', url: '/probe/any' });
  assert.equal(res.statusCode, 403, res.body);
  assert.deepEqual(res.json().error.details.requiredAnyOf, ['analytics.view', 'analytics.view.self']);
});

// ── rbac：Partner API 金鑰只通過白名單權限碼 ──

test('白名單內的權限碼放行：Partner API 金鑰呼叫要求 knowledge.admin 的路由', async () => {
  const res = await (await buildApp({ isPartnerKey: true, roleId: null })).inject({ method: 'GET', url: '/probe/knowledge-admin' });
  assert.equal(res.statusCode, 200, res.body);
});

test('白名單外的權限碼被拒：Partner API 金鑰呼叫要求 knowledge.view 的路由回 403', async () => {
  const res = await (await buildApp({ isPartnerKey: true, roleId: null })).inject({ method: 'GET', url: '/probe/knowledge-view' });
  assert.equal(res.statusCode, 403, res.body);
});

// ── 有效權限集合 ──

test('沒有角色的成員權限為空：roleId 為空時回 403', async () => {
  const res = await (await buildApp({ roleId: null })).inject({ method: 'GET', url: '/probe/tag-manage' });
  assert.equal(res.statusCode, 403, res.body);
});

// ── 有效權限集合的快取 ──

test('修改角色權限後立即生效：快取過的 tag.manage 被移除後，下一個請求回 403', async () => {
  const member = await createRole(['tag.view', 'tag.manage']);
  const memberApp = await buildApp({ roleId: member.id });
  const editorApp = await asRole(['role.view', 'role.manage', 'tag.view', 'tag.manage']);

  assert.equal((await memberApp.inject({ method: 'GET', url: '/probe/tag-manage' })).statusCode, 200);
  assert.ok(await redis.get(`perms:role:${member.id}`), '前提：R 的有效權限集合已經被快取');

  const put = await editorApp.inject({
    method: 'PUT',
    url: `/api/v1/roles/${member.id}/permissions`,
    payload: { permissions: ['tag.view'] },
  });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal((await memberApp.inject({ method: 'GET', url: '/probe/tag-manage' })).statusCode, 403);
});

// ── 目前使用者的權限端點 ──

test('回傳含 implies 的權限碼：角色授予 case.view 與 case.assign，回傳也含 agent.view', async () => {
  const res = await (await asRole(['case.view', 'case.assign'])).inject({ method: 'GET', url: '/api/v1/auth/me/permissions' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([...res.json().data.permissions].sort(), ['agent.view', 'case.assign', 'case.view']);
});

test('不回傳方案天花板之外的權限碼：方案不含 analytics，回傳不含 analytics.view', async () => {
  const role = await createRole(['analytics.view', 'inbox.view'], planTenant.id);
  const app = await buildApp({ roleId: role.id, tenantId: planTenant.id });
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me/permissions' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data.permissions, ['inbox.view']);
});
