/**
 * 聯絡人電話的字元與長度限制（change fix-w6-field-validation，spec contact-management
 * 「Contact Phone Format」；UAT E2E BUG-W6-08）。規則採寬鬆版：只限字元與長度，國際號碼也能存。
 *
 * 屬於 feature 組：走真實路由、權限與資料庫，資料加標記並在 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import contactRoutes from '#src/modules/contact/contact.routes.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-phone-${stamp}`,
    name: 'CI 聯絡人電話',
    permissions: { create: ['contact.view', 'contact.update'].map((permissionCode) => ({ permissionCode })) },
  },
});
const contact = await withTenant(prisma, T, (tx) =>
  tx.contact.create({ data: { tenantId: T, displayName: `CI 電話 ${stamp}`, phone: '0911000000' } }),
);

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: '00000000-0000-4000-8000-0000000000d1', tenantId: T, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
await app.ready();

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, (tx) => tx.contact.deleteMany({ where: { tenantId: T, id: contact.id } }));
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

const save = (phone: unknown) =>
  app.inject({ method: 'PATCH', url: `/api/v1/contacts/${contact.id}`, payload: { phone } });
const currentPhone = async () =>
  (await withTenant(prisma, T, (tx) => tx.contact.findFirst({ where: { tenantId: T, id: contact.id }, select: { phone: true } })))
    ?.phone ?? null;
const issuePaths = (res: { json: () => unknown }) =>
  ((res.json() as { error?: { details?: { issues?: Array<{ path: string }> } } }).error?.details?.issues ?? []).map(
    (i) => i.path,
  );

test('Taiwan and international numbers：台灣與國際號碼去頭尾空白後原樣存入', async () => {
  for (const phone of ['0912-345-678', '+886 912 345 678', '+1 (415) 555-0100 #12']) {
    const res = await save(`  ${phone}  `);
    assert.equal(res.statusCode, 200, `${phone}：${res.body}`);
    assert.equal(await currentPhone(), phone);
  }
});

test('Invalid characters：含其他字元回 400 並指出 phone，資料不變', async () => {
  await save('0911000000');
  const res = await save('<script>alert(1)</script>');
  assert.equal(res.statusCode, 400);
  assert.ok(issuePaths(res).includes('phone'));
  assert.equal(await currentPhone(), '0911000000');
});

test('Too long：31 位數字回 400 並指出 phone', async () => {
  const res = await save('1'.repeat(31));
  assert.equal(res.statusCode, 400);
  assert.ok(issuePaths(res).includes('phone'));
  assert.equal((await save('1'.repeat(30))).statusCode, 200, '30 位剛好上限應接受');
});

test('Clearing the phone：純空白視為清除', async () => {
  await save('0911000000');
  const res = await save('   ');
  assert.equal(res.statusCode, 200);
  assert.equal(await currentPhone(), null);
});
