/**
 * 主規格 role-management，以及 permission-model 在角色權限 API 上的情境
 * （change restore-rbac-permission-specs）。
 *
 * 路由層整合測試：走真實的 requirePermission、role.service、agent.service 與 app_tenant 連線（RLS）。
 * 每次執行建立一個專用租戶並種入三個系統角色，結束時整個刪除。
 * 測試名稱以「情境名稱：說明」開頭。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, seedRolesForTenant, redis } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import roleRoutes from '#src/modules/role/role.routes.js';
import agentRoutes from '#src/modules/agent/agent.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `ci-role-mgmt-${Date.now()}`;
let seq = 0;

// ── fixture ──
const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const system = await seedRolesForTenant(owner, T);

/** 建立自訂角色；名稱預設帶序號（API 的名稱上限是 20 字，不帶 MARK） */
async function createRole(permissions: string[], opts: { tenantId?: string; name?: string } = {}) {
  seq += 1;
  return owner.role.create({
    data: {
      tenantId: opts.tenantId ?? T,
      slug: `${MARK}-${seq}`,
      name: opts.name ?? `測試角色${seq}`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function createAgent(roleId: string) {
  seq += 1;
  return owner.agent.create({
    data: { tenantId: T, roleId, email: `${MARK}-${seq}@example.test`, name: `成員${seq}`, passwordHash: 'x' },
  });
}

/** 編輯者：有 role.manage 與 agent.role.assign，沒有 channel.delete */
const EDITOR_CODES = ['role.view', 'role.manage', 'agent.view', 'agent.role.assign', 'channel.view'];
const editorRole = await createRole(EDITOR_CODES);
const viewerRole = await createRole(['role.view']);
const adminAgent = await createAgent(system.admin!);
const editor = await createAgent(editorRole.id);
const viewer = await createAgent(viewerRole.id);
const foreignRole = await createRole(['tag.view'], { tenantId: B });

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
  await app.register(agentRoutes, { prefix: '/api/v1/agents' });
  await app.ready();
  return app;
}

const adminApp = await buildApp(adminAgent);
const editorApp = await buildApp(editor);
const viewerApp = await buildApp(viewer);

const codesOf = async (roleId: string) =>
  (await owner.rolePermission.findMany({ where: { roleId } })).map((r) => r.permissionCode).sort();
const putPerms = (app: typeof adminApp, roleId: string, permissions: string[]) =>
  app.inject({ method: 'PUT', url: `/api/v1/roles/${roleId}/permissions`, payload: { permissions } });
const setAgentRole = (app: typeof adminApp, agentId: string, roleId: string) =>
  app.inject({ method: 'PATCH', url: `/api/v1/agents/${agentId}/role`, payload: { roleId } });
const roleIdOf = async (agentId: string) => (await owner.agent.findUniqueOrThrow({ where: { id: agentId } })).roleId;

afterAll(async () => {
  await Promise.all([adminApp, editorApp, viewerApp].map((app) => app.close()));
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: { in: [T, B] }, slug: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

// ── 系統角色與自訂角色 ──

test('系統角色不能刪除：回 403，角色仍然存在', async () => {
  const res = await adminApp.inject({ method: 'DELETE', url: `/api/v1/roles/${system.supervisor}` });
  assert.equal(res.statusCode, 403, res.body);
  assert.ok(await owner.role.findUnique({ where: { id: system.supervisor } }));
});

test('系統角色改名不改 slug：回 200，名稱改變，slug 仍是 supervisor', async () => {
  const res = await adminApp.inject({ method: 'PATCH', url: `/api/v1/roles/${system.supervisor}`, payload: { name: '組長' } });
  assert.equal(res.statusCode, 200, res.body);
  const role = await owner.role.findUniqueOrThrow({ where: { id: system.supervisor } });
  assert.equal(role.name, '組長');
  assert.equal(role.slug, 'supervisor');
});

// ── 自訂角色建立時沒有權限 ──

test('只給名稱即可建立：回 201，isSystem 是 false，沒有任何權限碼', async () => {
  const res = await adminApp.inject({ method: 'POST', url: '/api/v1/roles', payload: { name: '行銷專員' } });
  assert.equal(res.statusCode, 201, res.body);
  const { id, isSystem } = res.json().data;
  assert.equal(isSystem, false);
  const perms = await adminApp.inject({ method: 'GET', url: `/api/v1/roles/${id}/permissions` });
  assert.deepEqual(perms.json().data.permissions, []);
});

test('同名的角色被拒：名稱去除前後空白後重複，回 422 DUPLICATE，不建立角色', async () => {
  await createRole([], { name: '客服組長' });
  const before = await owner.role.count({ where: { tenantId: T } });
  const res = await adminApp.inject({ method: 'POST', url: '/api/v1/roles', payload: { name: ' 客服組長 ' } });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'DUPLICATE');
  assert.equal(await owner.role.count({ where: { tenantId: T } }), before);
});

// ── 角色管理需要 role.manage ──

test('沒有 role.manage 不能設定權限：只有 role.view 的成員回 403，權限不變', async () => {
  const target = await createRole(['tag.view']);
  const res = await putPerms(viewerApp, target.id, ['tag.view', 'tag.manage']);
  assert.equal(res.statusCode, 403, res.body);
  // 確認是 role.manage 擋下的，不是越權防護（viewer 也沒有 tag.manage）
  assert.equal(res.json().error.details?.requiredPermission, 'role.manage');
  assert.deepEqual(await codesOf(target.id), ['tag.view']);
});

test('只有 role.view 也能查詢角色：GET /roles 回 200', async () => {
  const res = await viewerApp.inject({ method: 'GET', url: '/api/v1/roles' });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(res.json().data.roles.some((r: { id: string }) => r.id === system.admin));
});

// ── 角色的租戶隔離 ──

test('設定其他租戶的角色權限回 404：權限不變', async () => {
  const res = await putPerms(adminApp, foreignRole.id, ['tag.view', 'tag.manage']);
  assert.equal(res.statusCode, 404, res.body);
  assert.deepEqual(await codesOf(foreignRole.id), ['tag.view']);
});

test('查詢其他租戶的角色權限回 404：不回傳權限', async () => {
  const res = await adminApp.inject({ method: 'GET', url: `/api/v1/roles/${foreignRole.id}/permissions` });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});

test('請求主體的租戶 ID 不生效：新角色屬於登入成員的租戶', async () => {
  const res = await adminApp.inject({ method: 'POST', url: '/api/v1/roles', payload: { name: '跨租戶測試', tenantId: B } });
  assert.equal(res.statusCode, 201, res.body);
  const role = await owner.role.findUniqueOrThrow({ where: { id: res.json().data.id } });
  assert.equal(role.tenantId, T);
});

test('刪除角色時一併刪除權限資料列：沒有成員使用的自訂角色', async () => {
  const target = await createRole(['tag.view', 'tag.manage']);
  const res = await adminApp.inject({ method: 'DELETE', url: `/api/v1/roles/${target.id}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await owner.rolePermission.count({ where: { roleId: target.id } }), 0);
});

// ── 系統角色權限可以調整，但有安全鎖 ──

test('可以減少 supervisor 的權限：移除 marketing.broadcast 被接受', async () => {
  const wanted = DEFAULT_ROLE_PERMISSIONS.supervisor.filter((c) => c !== 'marketing.broadcast');
  const res = await putPerms(adminApp, system.supervisor!, wanted);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(await codesOf(system.supervisor!), [...wanted].sort());
});

test('admin 的鎖定權限不能移除：回 422 ADMIN_LOCK，admin 的權限不變', async () => {
  const before = await codesOf(system.admin!);
  const res = await putPerms(adminApp, system.admin!, before.filter((c) => c !== 'role.manage'));
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'ADMIN_LOCK');
  assert.deepEqual(await codesOf(system.admin!), before);
});

test('不能從自己的角色移除 role.manage：回 422 SELF_LOCK，權限不變', async () => {
  const res = await putPerms(editorApp, editorRole.id, EDITOR_CODES.filter((c) => c !== 'role.manage'));
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'SELF_LOCK');
  assert.deepEqual(await codesOf(editorRole.id), [...EDITOR_CODES].sort());
});

// ── 設定角色權限的越權防護 ──

test('授予自己沒有的權限碼被拒：回 403 PRIVILEGE_ESCALATION，權限不變', async () => {
  const target = await createRole(['channel.view']);
  const res = await putPerms(editorApp, target.id, ['channel.view', 'channel.delete']);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'PRIVILEGE_ESCALATION');
  assert.deepEqual(await codesOf(target.id), ['channel.view']);
});

test('admin 角色的編輯者不受限：admin 自己沒有 channel.delete，仍可授予', async () => {
  // admin 預設有全部權限；先拿掉 channel.delete，才測得到「admin 不做越權檢查」而不是「admin 剛好都有」
  await owner.rolePermission.deleteMany({ where: { roleId: system.admin!, permissionCode: 'channel.delete' } });
  await redis.del(`perms:role:${system.admin}`);
  const target = await createRole(['channel.view']);
  const res = await putPerms(adminApp, target.id, ['channel.view', 'channel.delete']);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(await codesOf(target.id), ['channel.delete', 'channel.view']);
});

// ── 指派角色給成員的越權防護 ──

test('指派權限比自己多的角色被拒：回 403 ROLE_ESCALATION，成員的角色不變', async () => {
  const target = await createAgent(viewerRole.id);
  const stronger = await createRole(['channel.view', 'channel.delete']);
  const res = await setAgentRole(editorApp, target.id, stronger.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'ROLE_ESCALATION');
  assert.ok(res.json().error.details.escalatedPermissions.includes('channel.delete'));
  assert.equal(await roleIdOf(target.id), viewerRole.id);
});

test('不能把自己改成沒有 role.manage 的角色：回 422 SELF_LOCK，角色不變', async () => {
  const weaker = await createRole(['role.view', 'agent.view']);
  const res = await setAgentRole(editorApp, editor.id, weaker.id);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'SELF_LOCK');
  assert.equal(await roleIdOf(editor.id), editorRole.id);
});

test('指派其他租戶的角色回 404：成員的角色不變', async () => {
  const target = await createAgent(viewerRole.id);
  const res = await setAgentRole(adminApp, target.id, foreignRole.id);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(await roleIdOf(target.id), viewerRole.id);
});

// ── 刪除使用中的角色 ──

test('有成員使用的角色不能刪除：回 409 ROLE_IN_USE，blockingAgentCount 是 2', async () => {
  const target = await createRole([]);
  await createAgent(target.id);
  await createAgent(target.id);
  const res = await adminApp.inject({ method: 'DELETE', url: `/api/v1/roles/${target.id}` });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'ROLE_IN_USE');
  assert.equal(res.json().error.details.blockingAgentCount, 2);
  assert.ok(await owner.role.findUnique({ where: { id: target.id } }));
});

test('沒有成員使用的角色可以刪除：回 200，角色不再存在', async () => {
  const target = await createRole([]);
  const res = await adminApp.inject({ method: 'DELETE', url: `/api/v1/roles/${target.id}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await owner.role.findUnique({ where: { id: target.id } }), null);
});

// ── 角色列表與權限矩陣 ──

test('角色列表標示系統角色：前三個是系統角色，其餘是自訂角色', async () => {
  const res = await viewerApp.inject({ method: 'GET', url: '/api/v1/roles' });
  const roles = res.json().data.roles as Array<{ isSystem: boolean }>;
  assert.deepEqual(roles.slice(0, 3).map((r) => r.isSystem), [true, true, true]);
  assert.ok(roles.length > 3);
  assert.ok(roles.slice(3).every((r) => r.isSystem === false));
});

test('權限矩陣涵蓋註冊表的每個權限點：每個碼恰好出現一次，位於它的 group，帶關聯欄位', async () => {
  const res = await viewerApp.inject({ method: 'GET', url: '/api/v1/roles/matrix' });
  assert.equal(res.statusCode, 200, res.body);
  type Cell = { code: string; dependsOn: unknown; implies: unknown; adminLock: unknown };
  const groups = res.json().data.groups as Array<{ group: string; permissions: Cell[] }>;
  const seen = groups.flatMap((g) => g.permissions.map((p) => ({ ...p, group: g.group })));
  assert.deepEqual(seen.map((p) => p.code).sort(), PERMISSIONS.map((p) => p.code).sort());
  for (const p of seen) {
    assert.equal(p.group, PERMISSIONS.find((d) => d.code === p.code)!.group, p.code);
    assert.ok(Array.isArray(p.dependsOn) && Array.isArray(p.implies), p.code);
    assert.equal(typeof p.adminLock, 'boolean', p.code);
  }
});

// ── permission-model：不在註冊表的碼、前置權限與隱含權限 ──

test('不在註冊表的權限碼不能授予：回 422 VALIDATION_ERROR，權限不變', async () => {
  const target = await createRole(['tag.view']);
  const res = await putPerms(adminApp, target.id, ['tag.view', 'unknown.code']);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.deepEqual(await codesOf(target.id), ['tag.view']);
});

test('缺少前置權限時被拒：回 422 DEPENDENCY_UNMET，missing 是 inbox.view，權限不變', async () => {
  const target = await createRole(['tag.view']);
  const res = await putPerms(adminApp, target.id, ['inbox.reply']);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'DEPENDENCY_UNMET');
  assert.equal(res.json().error.details.missing, 'inbox.view');
  assert.deepEqual(await codesOf(target.id), ['tag.view']);
});

test('同時授予前置權限時接受：角色持有 inbox.reply 與 inbox.view', async () => {
  const target = await createRole([]);
  const res = await putPerms(adminApp, target.id, ['inbox.reply', 'inbox.view']);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(await codesOf(target.id), ['inbox.reply', 'inbox.view']);
});

test('隱含權限不存成資料列：授予 case.assign 後，角色的權限不含 agent.view', async () => {
  const target = await createRole([]);
  assert.equal((await putPerms(adminApp, target.id, ['case.view', 'case.assign'])).statusCode, 200);
  const res = await adminApp.inject({ method: 'GET', url: `/api/v1/roles/${target.id}/permissions` });
  assert.deepEqual([...res.json().data.permissions].sort(), ['case.assign', 'case.view']);
});
