/**
 * PUT /api/v1/settings/tracking 的格式驗證（SEC：追蹤碼儲存型 XSS）。
 * gaId / metaPixelId 原本是 z.string()，任何字串都收，會被原樣注入短連結轉址頁的 <script>。
 * 驗證把字元限制在安全集合（GA4：G- 加大寫英數；Pixel：純數字），畸形值回 400、不落庫。
 * 認證以注入的成員取代，權限由真實的 requirePermission 依角色計算，結束時還原租戶設定。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
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

const original = await withTenant(prisma, T, (tx) =>
  tx.tenantSettings.findFirst({ where: { tenantId: T }, select: { gaId: true, metaPixelId: true } }),
);

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
await app.ready();

const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/v1/settings/tracking', payload });
const stored = () =>
  withTenant(prisma, T, (tx) => tx.tenantSettings.findFirst({ where: { tenantId: T }, select: { gaId: true, metaPixelId: true } }));

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, (tx) =>
    tx.tenantSettings.updateMany({
      where: { tenantId: T },
      data: { gaId: original?.gaId ?? null, metaPixelId: original?.metaPixelId ?? null },
    }),
  );
  await prisma.tenantAuditLog.deleteMany({ where: { tenantId: T, actorId: agent.id } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: agent.id } });
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

test('gaId 含 </script> 的 XSS payload：回 400，不落庫', async () => {
  const res = await put({ gaId: '</script><script>alert(1)</script>', metaPixelId: null });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.equal(res.json().error.details.issues[0].path, 'gaId');
  const row = await stored();
  assert.notEqual(row?.gaId, '</script><script>alert(1)</script>', '畸形值不得寫入');
});

test('metaPixelId 含引號的 XSS payload：回 400，不落庫', async () => {
  const res = await put({ gaId: null, metaPixelId: "');alert(1);//" });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.details.issues[0].path, 'metaPixelId');
});

test('gaId 不是 G- 開頭：回 400', async () => {
  const res = await put({ gaId: 'UA-123456', metaPixelId: null });
  assert.equal(res.statusCode, 400, res.body);
});

test('合法的 GA4 與 Pixel ID：回 200 並寫入', async () => {
  const res = await put({ gaId: 'G-ABC1234567', metaPixelId: '1234567890123456' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { gaId: 'G-ABC1234567', metaPixelId: '1234567890123456' });
});

test('null 清除設定：回 200', async () => {
  const res = await put({ gaId: null, metaPixelId: null });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { gaId: null, metaPixelId: null });
});
