/**
 * 依租戶查詢平台稽核紀錄（change add-platform-tenant-audit-logs，規格 platform-audit-log、
 * platform-user-management「平台帳號詳細頁可查詢該帳號相關的稽核記錄」）。
 *
 * 走真實的 platform.routes、platform-audit.service 與測試資料庫。平台認證換成固定的平台帳號；
 * 沒有憑證時被拒由 tests/unit/modules/platform/platform-auth-guard.test.ts 對每一條平台路由檢查。
 * 建立的租戶、成員、方案申請、平台帳號與稽核都帶 stamp，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import platformRoutes from '#src/modules/platform/platform.routes.js';

loadEnvConfig();

const prisma = new PrismaClient();
const stamp = Date.now();
const MIN = 60 * 1000;
const base = Date.now() - 60 * MIN;
const at = (minutes: number) => new Date(base + minutes * MIN);

const platformUser = await prisma.platformUser.create({
  data: { email: `ci-tenant-audit-${stamp}@example.test`, name: `CI 稽核操作者 ${stamp}`, passwordHash: 'x' },
});
const tenantA = await prisma.tenant.create({ data: { name: `CI 稽核租戶 A ${stamp}` } });
const tenantB = await prisma.tenant.create({ data: { name: `CI 稽核租戶 B ${stamp}` } });
const tenantC = await prisma.tenant.create({ data: { name: `CI 稽核租戶 C ${stamp}` } });
const agentA = await prisma.agent.create({
  data: { tenantId: tenantA.id, email: `ci-tenant-audit-agent-${stamp}@example.test`, name: 'CI 成員', passwordHash: 'x' },
});
const requestA = await prisma.planChangeRequest.create({
  data: { tenantId: tenantA.id, type: 'upgrade', targetPlanSlug: 'pro' },
});

// 租戶 A：停用（最舊）→ 成員改 Email → 升級申請核准（最新）；租戶 B：停用
await prisma.platformAuditLog.createMany({
  data: [
    { platformUserId: platformUser.id, action: 'tenant.disable', targetType: 'tenant', targetId: tenantA.id, createdAt: at(1) },
    {
      platformUserId: platformUser.id,
      action: 'tenant.agent.email.update',
      targetType: 'agent',
      targetId: agentA.id,
      payload: { tenantId: tenantA.id, email: agentA.email },
      createdAt: at(2),
    },
    {
      platformUserId: platformUser.id,
      action: 'plan_change.approve',
      targetType: 'plan_change_request',
      targetId: requestA.id,
      createdAt: at(3),
    },
    { platformUserId: platformUser.id, action: 'tenant.disable', targetType: 'tenant', targetId: tenantB.id, createdAt: at(4) },
    // 租戶 C：三筆，用來測筆數上限
    { action: 'tenant.trial.expire', targetType: 'tenant', targetId: tenantC.id, createdAt: at(5) },
    { platformUserId: platformUser.id, action: 'tenant.enable', targetType: 'tenant', targetId: tenantC.id, createdAt: at(6) },
    { platformUserId: platformUser.id, action: 'tenant.update', targetType: 'tenant', targetId: tenantC.id, createdAt: at(7) },
  ],
});

const app = Fastify();
app.decorate('prismaAdmin', prisma as never);
app.decorateRequest('platformUser', null);
app.decorate('authenticatePlatformSuperuser', async (req: { platformUser: unknown }) => {
  req.platformUser = { id: platformUser.id, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
});
await app.register(errorHandlerPlugin);
await app.register(platformRoutes, { prefix: '/api/v1/platform' });
await app.ready();

afterAll(async () => {
  await app.close();
  const tenantIds = [tenantA.id, tenantB.id, tenantC.id];
  await prisma.platformAuditLog.deleteMany({ where: { targetId: { in: [...tenantIds, agentA.id, requestA.id] } } });
  await prisma.platformAuditLog.deleteMany({ where: { platformUserId: platformUser.id } });
  await prisma.platformUser.delete({ where: { id: platformUser.id } });
  await prisma.planChangeRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.agent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

interface Entry {
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  targetTenantId: string | null;
  actor: { id: string; name: string; email: string } | null;
}

const getTenantLogs = (tenantId: string, query = '') =>
  app.inject({ method: 'GET', url: `/api/v1/platform/tenants/${tenantId}/audit-logs${query}` });

test('回傳租戶、成員與方案申請的紀錄，不含其他租戶', async () => {
  const res = await getTenantLogs(tenantA.id);
  assert.equal(res.statusCode, 200);
  const { items, hasMore } = res.json().data as { items: Entry[]; hasMore: boolean };
  assert.deepEqual(
    items.map((i) => i.action),
    ['plan_change.approve', 'tenant.agent.email.update', 'tenant.disable'],
  );
  assert.equal(hasMore, false);
  // 名稱解析（規格「解析各類型對象的名稱」，走真實資料庫）
  assert.deepEqual(
    items.map((i) => [i.targetLabel, i.targetTenantId]),
    [
      [tenantA.name, tenantA.id],
      [agentA.email, tenantA.id],
      [tenantA.name, tenantA.id],
    ],
  );
  assert.deepEqual(items[0]!.actor, { id: platformUser.id, name: platformUser.name, email: platformUser.email });
});

test('租戶不存在', async () => {
  const res = await getTenantLogs('99999999-9999-4999-8999-999999999999');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
});

test('紀錄超過上限', async () => {
  const res = await getTenantLogs(tenantC.id, '?limit=2');
  assert.equal(res.statusCode, 200);
  const { items, hasMore } = res.json().data as { items: Entry[]; hasMore: boolean };
  assert.deepEqual(items.map((i) => i.action), ['tenant.update', 'tenant.enable']);
  assert.equal(hasMore, true);
});

test('紀錄未超過上限', async () => {
  const res = await getTenantLogs(tenantC.id, '?limit=3');
  const { items, hasMore } = res.json().data as { items: Entry[]; hasMore: boolean };
  assert.equal(items.length, 3);
  assert.equal(hasMore, false);
  // 系統排程寫入的紀錄沒有操作者
  assert.equal(items[2]!.actor, null);
});

test('limit 超出範圍', async () => {
  const res = await getTenantLogs(tenantC.id, '?limit=500');
  assert.equal(res.statusCode, 400);
});

test('帳號稽核記錄附上對象名稱', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/platform/platform-users/${platformUser.id}/audit-logs` });
  assert.equal(res.statusCode, 200);
  const items = res.json().data as Entry[];
  const disableB = items.find((i) => i.action === 'tenant.disable' && i.targetTenantId === tenantB.id);
  assert.ok(disableB, '應含停用租戶 B 的紀錄');
  assert.equal(disableB.targetLabel, tenantB.name);
});
