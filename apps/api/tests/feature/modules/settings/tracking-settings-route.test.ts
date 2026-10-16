/**
 * GET／PUT /api/v1/settings/tracking，走真實路由。格式驗證來自 change fix-admin-settings-safeguards
 * （tracking-settings「追蹤 ID 的格式驗證」）；讀取、更新、權限與稽核來自 change
 * restore-tenant-tracking-pixels-specs（「讀取追蹤設定」「更新追蹤設定」）。單元測試只測 schema 本身；這裡確認路由真的套用 schema、
 * 格式不符回 400 `VALIDATION_ERROR`，且已儲存的設定不變。
 * 認證以注入的成員取代，權限由真實的 requirePermission 依角色計算，結束時還原租戶設定。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = Date.now();

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-tracking-${stamp}`,
    name: 'CI 追蹤設定',
    permissions: { create: [{ permissionCode: 'settings.manage' }] },
  },
});
const agent = await prisma.agent.create({
  data: { tenantId: T, email: `ci-tracking-${stamp}@example.test`, name: 'CI 追蹤', passwordHash: 'x', roleId: role.id },
});
// 沒有 settings.manage 的成員：檢查權限的情境用
const plainRole = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-tracking-plain-${stamp}`,
    name: 'CI 追蹤（無權限）',
    permissions: { create: [{ permissionCode: 'inbox.view' }] },
  },
});
const plainAgent = await prisma.agent.create({
  data: { tenantId: T, email: `ci-tracking-plain-${stamp}@example.test`, name: 'CI 追蹤無權限', passwordHash: 'x', roleId: plainRole.id },
});
let actor = { id: agent.id, roleId: role.id };

const select = { gaId: true, metaPixelId: true } as const;
const original = await withTenant(prisma, T, (tx) => tx.tenantSettings.findFirst({ where: { tenantId: T }, select }));

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: actor.id, tenantId: T, role: 'ADMIN', roleId: actor.roleId } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
await app.ready();

const VALID = { gaId: 'G-ABC123XYZ9', metaPixelId: '123456789012345' };
const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/v1/settings/tracking', payload });
const stored = () => withTenant(prisma, T, (tx) => tx.tenantSettings.findFirst({ where: { tenantId: T }, select }));

// 每個測試從同一組合格設定開始，才能斷言「已儲存的設定不變」
beforeEach(async () => {
  const res = await put(VALID);
  assert.equal(res.statusCode, 200, res.body);
});

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, (tx) =>
    tx.tenantSettings.updateMany({
      where: { tenantId: T },
      data: { gaId: original?.gaId ?? null, metaPixelId: original?.metaPixelId ?? null },
    }),
  );
  await prisma.tenantAuditLog.deleteMany({ where: { tenantId: T, actorId: agent.id } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: [agent.id, plainAgent.id] } } });
  await prisma.role.deleteMany({ where: { id: { in: [role.id, plainRole.id] } } });
  await prisma.$disconnect();
});

async function assertRejected(payload: object, field: string) {
  const res = await put(payload);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.equal(res.json().error.details.issues[0].path, field);
  assert.deepEqual(await stored(), VALID);
}

test('合格的 ID 可以儲存', async () => {
  const res = await put({ gaId: 'G-ZZZ999', metaPixelId: '98765' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { gaId: 'G-ZZZ999', metaPixelId: '98765' });
  assert.deepEqual(await stored(), { gaId: 'G-ZZZ999', metaPixelId: '98765' });
});

test('含程式碼的 GA ID 被拒', async () => {
  await assertRejected({ gaId: "G-1');alert(1);//" }, 'gaId');
});

test('非數字的 Pixel ID 被拒', async () => {
  await assertRejected({ metaPixelId: '123</script><script>alert(1)</script>' }, 'metaPixelId');
});

test('含小寫字母的 GA ID 被拒', async () => {
  await assertRejected({ gaId: 'g-ABC123XYZ9' }, 'gaId');
  await assertRejected({ gaId: 'G-abc123xyz9' }, 'gaId');
});

test('空字串清除設定', async () => {
  const res = await put({ gaId: '', metaPixelId: null });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { gaId: null, metaPixelId: null });
  assert.deepEqual(await stored(), { gaId: null, metaPixelId: null });
});

async function asPlainAgent<T>(fn: () => Promise<T>): Promise<T> {
  actor = { id: plainAgent.id, roleId: plainRole.id };
  try {
    return await fn();
  } finally {
    actor = { id: agent.id, roleId: role.id };
  }
}

test('讀取已設定的 ID', async () => {
  assert.equal((await put({ gaId: 'G-ABC123XYZ9' })).statusCode, 200);
  const res = await app.inject({ method: 'GET', url: '/api/v1/settings/tracking' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { gaId: 'G-ABC123XYZ9', metaPixelId: null });
});

test('沒有 settings.manage 不能讀取', async () => {
  const res = await asPlainAgent(() => app.inject({ method: 'GET', url: '/api/v1/settings/tracking' }));
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'settings.manage');
});

test('沒有送的欄位被清除', async () => {
  const res = await put({ gaId: 'G-NEW123XYZ9' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { gaId: 'G-NEW123XYZ9', metaPixelId: null });
  assert.deepEqual(await stored(), { gaId: 'G-NEW123XYZ9', metaPixelId: null });
});

test('稽核不記錄 ID 的值', async () => {
  const since = new Date();
  assert.equal((await put({ gaId: 'G-ABC123XYZ9', metaPixelId: null })).statusCode, 200);
  const logs = await prisma.tenantAuditLog.findMany({
    where: { tenantId: T, actorId: agent.id, action: 'settings.update', createdAt: { gte: since } },
  });
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].payload, { section: 'tracking', gaIdSet: true, metaPixelIdSet: false });
  assert.ok(!JSON.stringify(logs[0].payload).includes('G-ABC123XYZ9'));
});

test('沒有 settings.manage 不能更新', async () => {
  const res = await asPlainAgent(() => put({ gaId: 'G-OTHER12345' }));
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'settings.manage');
  assert.deepEqual(await stored(), VALID);
});
