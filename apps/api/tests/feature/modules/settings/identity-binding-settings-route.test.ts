/**
 * PUT /api/v1/settings/identity-binding（change add-email-identity-merge，spec email-identity-merge
 * 「設定頁沒送 email 欄位」）。通過認證之後的路由層整合測試：認證以注入的成員取代，
 * 權限由真實的 requirePermission 依角色計算。結束時還原租戶設定（原本沒有設定列就刪除）。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = Date.now();

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-ib-settings-${stamp}`,
    name: 'CI 跨渠道綁定設定',
    permissions: { create: [{ permissionCode: 'settings.manage' }] },
  },
});
const agent = await prisma.agent.create({
  data: { tenantId: T, email: `ci-ib-settings-${stamp}@example.test`, name: 'CI 設定', passwordHash: 'x', roleId: role.id },
});

const original = await withTenant(prisma, T, (tx) =>
  tx.tenantSettings.findFirst({ where: { tenantId: T }, select: { identityBinding: true } }),
);
const setStored = (identityBinding: object) =>
  withTenant(prisma, T, (tx) =>
    tx.tenantSettings.upsert({ where: { tenantId: T }, create: { tenantId: T, identityBinding }, update: { identityBinding } }),
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

const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/v1/settings/identity-binding', payload });
const legacyBody = (bindKeywords: string[]) => ({ enabled: true, bindKeywords, unbindKeywords: ['解除綁定'] });

beforeEach(async () => {
  await setStored({ enabled: true, bindKeywords: ['綁定帳號'], unbindKeywords: ['解除綁定'], emailEnabled: true, emailKeywords: ['自訂關鍵字'] });
  invalidateIdentityBindingSettings();
});

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, (tx) =>
    original
      ? tx.tenantSettings.updateMany({ where: { tenantId: T }, data: { identityBinding: (original.identityBinding ?? {}) as object } })
      : tx.tenantSettings.deleteMany({ where: { tenantId: T } }),
  );
  invalidateIdentityBindingSettings();
  await prisma.tenantAuditLog.deleteMany({ where: { tenantId: T, actorId: agent.id } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: agent.id } });
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

test('設定頁沒送 email 欄位', async () => {
  const res = await put(legacyBody(['綁定帳號', '綁定']));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.emailEnabled, true, 'email 登記維持啟用');
  assert.deepEqual(res.json().data.emailKeywords, ['自訂關鍵字'], '關鍵字不變');
});

test('沒送 email 關鍵字時，與已儲存的 email 關鍵字衝突也回 400', async () => {
  const res = await put(legacyBody(['自訂關鍵字']));
  assert.equal(res.statusCode, 400, res.body);
  const error = res.json().error;
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.equal(error.details.issues[0].path, 'emailKeywords', '與 Zod 錯誤相同，path 為字串');
  const stored = await withTenant(prisma, T, (tx) => tx.tenantSettings.findFirst({ where: { tenantId: T } }));
  assert.deepEqual((stored?.identityBinding as { bindKeywords: string[] }).bindKeywords, ['綁定帳號'], '不更改資料');
});
