/**
 * 主規格 agent-management 與 agent-lifecycle（change rewrite-agent-management-spec）。
 *
 * 路由層整合測試：走真實的 requirePermission、agent.service 與 app_tenant 連線（RLS）。
 * 每次執行建立一個專用租戶並種入三個系統角色，結束時整個刪除。
 * 「重新啟用成員」的兩個情境現況違反（AUDIT），修正時再補測試。
 * 測試名稱以「情境名稱：說明」開頭。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { seedRolesForTenant } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import agentRoutes from '#src/modules/agent/agent.routes.js';
import { hashPassword, verifyPassword } from '#src/shared/utils/password.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `ci-agent-mgmt-${Date.now()}`;
const PASSWORD = 'old-password-1';
let seq = 0;

// ── fixture ──
const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const system = await seedRolesForTenant(owner, T);
const passwordHash = await hashPassword(PASSWORD);

const email = () => `${MARK}-${++seq}@example.test`;

async function createRole(permissions: string[]) {
  seq += 1;
  return owner.role.create({
    data: {
      tenantId: T,
      slug: `${MARK}-${seq}`,
      name: `測試角色${seq}`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function createAgent(roleId: string, opts: { tenantId?: string; role?: 'ADMIN' | 'AGENT' } = {}) {
  return owner.agent.create({
    data: {
      tenantId: opts.tenantId ?? T,
      roleId,
      role: opts.role ?? 'AGENT',
      email: email(),
      name: `成員${seq}`,
      passwordHash,
    },
  });
}

/** 管理者：自訂角色，有成員管理的各個權限碼，角色列舉不是 ADMIN（不算管理員） */
const MANAGER_CODES = [
  'agent.view', 'agent.manage', 'agent.role.assign', 'agent.password.reset',
  'agent.deactivate', 'agent.purge', 'role.view',
];
const managerRole = await createRole(MANAGER_CODES);
const plainRole = await createRole(['agent.view']);
/** 租戶唯一的管理員 */
const admin = await createAgent(system.admin!, { role: 'ADMIN' });
const manager = await createAgent(managerRole.id);
const plain = await createAgent(plainRole.id);
const foreign = await owner.agent.create({
  data: { tenantId: B, email: email(), name: MARK, passwordHash },
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
  await app.register(agentRoutes, { prefix: '/api/v1/agents' });
  await app.ready();
  return app;
}

const managerApp = await buildApp(manager);
const plainApp = await buildApp(plain);

const createBody = (overrides: object = {}) => ({
  name: '新成員',
  email: email(),
  password: 'new-password-1',
  role: 'AGENT',
  roleId: plainRole.id,
  ...overrides,
});
const reload = (id: string) => owner.agent.findUnique({ where: { id } });

afterAll(async () => {
  await managerApp.close();
  await plainApp.close();
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: T } });
  await owner.case.deleteMany({ where: { tenantId: T } });
  await owner.contact.deleteMany({ where: { tenantId: T } });
  await owner.channel.deleteMany({ where: { tenantId: T } });
  await owner.notification.deleteMany({ where: { tenantId: T } });
  await owner.cliSession.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { id: foreign.id } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

// ── agent-management：建立成員 ──

test('建立成員成功：回 201，屬於本租戶，回應不含 passwordHash', async () => {
  const res = await managerApp.inject({ method: 'POST', url: '/api/v1/agents', payload: createBody() });
  assert.equal(res.statusCode, 201, res.body);
  const data = res.json().data;
  assert.equal(data.tenantId, T);
  assert.equal('passwordHash' in data, false);
});

test('沒有 agent.manage 時被拒：回 403，不建立成員', async () => {
  const body = createBody();
  const res = await plainApp.inject({ method: 'POST', url: '/api/v1/agents', payload: body });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(await owner.agent.findUnique({ where: { email: body.email } }), null);
});

test('email 已被其他租戶使用：回 409 CONFLICT，不建立成員', async () => {
  const before = await owner.agent.count({ where: { tenantId: T } });
  const res = await managerApp.inject({ method: 'POST', url: '/api/v1/agents', payload: createBody({ email: foreign.email }) });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'CONFLICT');
  assert.equal(await owner.agent.count({ where: { tenantId: T } }), before);
});

test('密碼太短：回 400 VALIDATION_ERROR，不建立成員', async () => {
  const body = createBody({ password: 'short' });
  const res = await managerApp.inject({ method: 'POST', url: '/api/v1/agents', payload: body });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.equal(await owner.agent.findUnique({ where: { email: body.email } }), null);
});

// ── agent-management：指派成員的角色 ──

test('以 roleId 改成員的角色：回 200，角色是 R', async () => {
  const target = await createAgent(plainRole.id);
  const r = await createRole(['agent.view', 'role.view']);
  const res = await managerApp.inject({ method: 'PATCH', url: `/api/v1/agents/${target.id}/role`, payload: { roleId: r.id } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await reload(target.id))!.roleId, r.id);
});

test('以角色列舉指定系統角色：{ role: "SUPERVISOR" } 改成 supervisor 系統角色', async () => {
  // 越權防護：supervisor 的權限超出管理者，改由 admin 指派
  const adminApp = await buildApp(admin);
  const target = await createAgent(plainRole.id);
  const res = await adminApp.inject({ method: 'PATCH', url: `/api/v1/agents/${target.id}/role`, payload: { role: 'SUPERVISOR' } });
  await adminApp.close();
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await reload(target.id))!.roleId, system.supervisor);
});

test('成員不存在：回 404', async () => {
  const res = await managerApp.inject({
    method: 'PATCH',
    url: '/api/v1/agents/00000000-0000-4000-8000-000000000999/role',
    payload: { roleId: plainRole.id },
  });
  assert.equal(res.statusCode, 404, res.body);
});

test('沒有 agent.role.assign 時被拒：回 403，角色不變', async () => {
  const target = await createAgent(plainRole.id);
  const res = await plainApp.inject({ method: 'PATCH', url: `/api/v1/agents/${target.id}/role`, payload: { roleId: managerRole.id } });
  assert.equal(res.statusCode, 403, res.body);
  // 確認是 agent.role.assign 擋下的，不是越權防護（managerRole 的權限也超出 plain）
  assert.equal(res.json().error.details?.requiredPermission, 'agent.role.assign');
  assert.equal((await reload(target.id))!.roleId, plainRole.id);
});

// ── agent-management：重設其他成員的密碼 ──

const resetPassword = (app: typeof managerApp, id: string) =>
  app.inject({ method: 'PATCH', url: `/api/v1/agents/${id}/password`, payload: { newPassword: 'reset-password-1' } });

test('重設後以新密碼登入：回 200，密碼變成新密碼', async () => {
  const target = await createAgent(plainRole.id);
  const res = await resetPassword(managerApp, target.id);
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(await verifyPassword('reset-password-1', (await reload(target.id))!.passwordHash));
});

test('沒有 agent.password.reset 時被拒：回 403，密碼不變', async () => {
  const target = await createAgent(plainRole.id);
  const res = await resetPassword(plainApp, target.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.ok(await verifyPassword(PASSWORD, (await reload(target.id))!.passwordHash));
});

test('重設其他租戶的成員回 404：密碼不變', async () => {
  const res = await resetPassword(managerApp, foreign.id);
  assert.equal(res.statusCode, 404, res.body);
  assert.ok(await verifyPassword(PASSWORD, (await reload(foreign.id))!.passwordHash));
});

// ── agent-management：Change Own Password ──

async function changeOwn(currentPassword: string, newPassword: string) {
  const self = await createAgent(plainRole.id);
  const app = await buildApp(self);
  const res = await app.inject({ method: 'PATCH', url: '/api/v1/agents/me/password', payload: { currentPassword, newPassword } });
  await app.close();
  return { res, hash: (await reload(self.id))!.passwordHash };
}

test('Agent changes password successfully：目前密碼正確，回 200，密碼變成新密碼', async () => {
  const { res, hash } = await changeOwn(PASSWORD, 'brand-new-password');
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(await verifyPassword('brand-new-password', hash));
});

test('Wrong current password：回 400 INVALID_PASSWORD，密碼不變', async () => {
  const { res, hash } = await changeOwn('not-the-password', 'brand-new-password');
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'INVALID_PASSWORD');
  assert.ok(await verifyPassword(PASSWORD, hash));
});

test('New password too short：回 400 VALIDATION_ERROR，密碼不變', async () => {
  const { res, hash } = await changeOwn(PASSWORD, 'short');
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.ok(await verifyPassword(PASSWORD, hash));
});

// ── agent-lifecycle：停用成員 ──

const deactivate = (app: typeof managerApp, id: string) =>
  app.inject({ method: 'POST', url: `/api/v1/agents/${id}/deactivate` });

test('停用保留記錄與 email：回 204，記錄還在、isActive 是 false，同一個 email 建立成員回 409', async () => {
  const target = await createAgent(plainRole.id);
  const res = await deactivate(managerApp, target.id);
  assert.equal(res.statusCode, 204, res.body);
  const row = await reload(target.id);
  assert.ok(row);
  assert.equal(row.isActive, false);
  const again = await managerApp.inject({ method: 'POST', url: '/api/v1/agents', payload: createBody({ email: target.email }) });
  assert.equal(again.statusCode, 409, again.body);
});

test('停用的成員不出現在成員列表：GET /agents 不含停用的成員', async () => {
  const target = await createAgent(plainRole.id);
  assert.equal((await deactivate(managerApp, target.id)).statusCode, 204);
  const res = await plainApp.inject({ method: 'GET', url: '/api/v1/agents' });
  assert.equal(res.statusCode, 200, res.body);
  const ids = (res.json().data as Array<{ id: string }>).map((a) => a.id);
  assert.ok(ids.includes(manager.id), '前提：列表含啟用中的成員');
  assert.equal(ids.includes(target.id), false);
});

test('停用需權限：沒有 agent.deactivate 時回 403，成員維持啟用', async () => {
  const target = await createAgent(plainRole.id);
  const res = await deactivate(plainApp, target.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal((await reload(target.id))!.isActive, true);
});

test('不能停用自己：回 422 SELF_ACTION_FORBIDDEN，成員維持啟用', async () => {
  const res = await deactivate(managerApp, manager.id);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'SELF_ACTION_FORBIDDEN');
  assert.equal((await reload(manager.id))!.isActive, true);
});

test('不能停用最後一位管理員：回 422 LAST_ADMIN_PROTECTED，管理員維持啟用', async () => {
  const res = await deactivate(managerApp, admin.id);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'LAST_ADMIN_PROTECTED');
  assert.equal((await reload(admin.id))!.isActive, true);
});

// ── agent-lifecycle：永久刪除成員 ──

const purge = (app: typeof managerApp, id: string) => app.inject({ method: 'DELETE', url: `/api/v1/agents/${id}` });

test('刪除釋放 email：回 204，記錄不再存在，同一個 email 可以建立成員', async () => {
  const target = await createAgent(plainRole.id);
  const res = await purge(managerApp, target.id);
  assert.equal(res.statusCode, 204, res.body);
  assert.equal(await reload(target.id), null);
  const again = await managerApp.inject({ method: 'POST', url: '/api/v1/agents', payload: createBody({ email: target.email }) });
  assert.equal(again.statusCode, 201, again.body);
});

test('刪除清理會阻止刪除的關聯：有通知與 CLI session 的成員也能刪除', async () => {
  const target = await createAgent(plainRole.id);
  await owner.notification.create({ data: { tenantId: T, agentId: target.id, type: 'test', title: MARK, body: MARK } });
  await owner.cliSession.create({
    data: {
      tenantId: T,
      agentId: target.id,
      name: MARK,
      tokenHash: `${MARK}-${target.id}`,
      tokenPrefix: 'cli_test_',
      tokenSuffix: 'abcd',
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const res = await purge(managerApp, target.id);
  assert.equal(res.statusCode, 204, res.body);
  assert.equal(await reload(target.id), null);
  assert.equal(await owner.notification.count({ where: { agentId: target.id } }), 0);
  assert.equal(await owner.cliSession.count({ where: { agentId: target.id } }), 0);
});

test('刪除保留歷史：成員負責的工單仍然存在，負責人改為空值', async () => {
  const target = await createAgent(plainRole.id);
  const channel = await owner.channel.create({
    data: { tenantId: T, channelType: 'WEBCHAT', displayName: MARK, credentialsEncrypted: 'x' },
  });
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: MARK } });
  const kase = await owner.case.create({
    data: { tenantId: T, contactId: contact.id, channelId: channel.id, title: MARK, assigneeId: target.id },
  });
  assert.equal((await purge(managerApp, target.id)).statusCode, 204);
  const after = await owner.case.findUnique({ where: { id: kase.id } });
  assert.ok(after);
  assert.equal(after.assigneeId, null);
});

test('刪除需權限且限本租戶：沒有 agent.purge 回 403；其他租戶的成員回 404，兩者都還在', async () => {
  const target = await createAgent(plainRole.id);
  const denied = await purge(plainApp, target.id);
  assert.equal(denied.statusCode, 403, denied.body);
  const cross = await purge(managerApp, foreign.id);
  assert.equal(cross.statusCode, 404, cross.body);
  assert.ok(await reload(target.id));
  assert.ok(await reload(foreign.id));
});

test('不能刪除自己：回 422 SELF_ACTION_FORBIDDEN，成員仍然存在', async () => {
  const res = await purge(managerApp, manager.id);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'SELF_ACTION_FORBIDDEN');
  assert.ok(await reload(manager.id));
});

test('不能刪除最後一位管理員：回 422 LAST_ADMIN_PROTECTED，管理員仍然存在', async () => {
  const res = await purge(managerApp, admin.id);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'LAST_ADMIN_PROTECTED');
  assert.ok(await reload(admin.id));
});
