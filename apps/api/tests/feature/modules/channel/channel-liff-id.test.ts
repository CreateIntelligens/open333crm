/**
 * 渠道設定的 LIFF ID 儲存時驗證格式（change fix-w6-field-validation，spec shortlink-ua-strategy
 * 「LIFF ID Format Is Validated On Save」）。
 *
 * LIFF ID 存在 settings.liffConfig.liffId（BotConfigForm 寫入、短連結的 LIFF 轉址讀取）。
 * 格式：10 位數字、-、8 個英數字（LINE 文件範例 1234567890-AbcdEfgh）。
 *
 * 屬於 feature 組：走真實路由與資料庫，資料加標記並在 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-liff-${stamp}`,
    name: 'CI LIFF ID',
    permissions: { create: ['channel.view', 'channel.update'].map((permissionCode) => ({ permissionCode })) },
  },
});
const channel = await withTenant(prisma, T, (tx) =>
  tx.channel.create({
    data: {
      tenantId: T,
      channelType: 'LINE',
      displayName: `CI LIFF ${stamp}`,
      credentialsEncrypted: 'x',
      isActive: false,
      settings: { liffConfig: { liffId: '1111111111-OrigOrig' } },
    },
  }),
);

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: '00000000-0000-4000-8000-0000000000d2', tenantId: T, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(channelRoutes, { prefix: '/api/v1/channels' });
await app.ready();

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, (tx) => tx.channel.deleteMany({ where: { tenantId: T, id: channel.id } }));
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

const saveLiffId = (liffId: string) =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/channels/${channel.id}`,
    payload: { settings: { liffConfig: { liffId } } },
  });
const storedLiffId = async () => {
  const row = await withTenant(prisma, T, (tx) =>
    tx.channel.findFirst({ where: { tenantId: T, id: channel.id }, select: { settings: true } }),
  );
  return ((row?.settings as { liffConfig?: { liffId?: string } } | null)?.liffConfig?.liffId) ?? null;
};

test('Valid LIFF ID：格式正確的 LIFF ID 去空白後存入', async () => {
  const res = await saveLiffId(' 1234567890-AbcdEfgh ');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await storedLiffId(), '1234567890-AbcdEfgh');
});

test('Invalid LIFF ID：格式不符回 400，設定不變', async () => {
  await saveLiffId('1234567890-AbcdEfgh');
  for (const bad of ['<script>alert(1)</script>', '1234-abcd', '1234567890-Abcd!fgh', '12345678901-AbcdEfgh']) {
    const res = await saveLiffId(bad);
    assert.equal(res.statusCode, 400, `${bad} 應被擋下`);
    assert.equal(await storedLiffId(), '1234567890-AbcdEfgh');
  }
});

test('空字串視為清除 LIFF ID', async () => {
  const res = await saveLiffId('');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await storedLiffId(), '');
});
