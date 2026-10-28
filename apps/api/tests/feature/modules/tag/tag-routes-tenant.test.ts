/**
 * 標籤管理路由的租戶邊界（#337 階段 3）：route 以請求者的租戶開交易（tag.flow.ts）。
 * - 列表只有自己租戶的標籤。
 * - 刪除其他租戶的標籤回 404，該標籤不受影響；刪除自己租戶的標籤成功。
 * 屬於 feature 組：走真實路由、權限與 app_tenant 連線（RLS）。本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import tagRoutes from '#src/modules/tag/tag.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `ci-tag-routes-tenant-${Date.now()}`;

const role = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-role`,
    name: `${MARK}-role`,
    permissions: { create: ['tag.view', 'tag.manage'].map((permissionCode) => ({ permissionCode })) },
  },
});
const agent = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}@example.test`, name: MARK, passwordHash: 'x' },
});
const ownTag = await owner.tag.create({ data: { tenantId: A, name: `${MARK}-A`, scope: 'CONTACT' } });
const otherTag = await owner.tag.create({ data: { tenantId: B, name: `${MARK}-B`, scope: 'CONTACT' } });

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
});
await app.register(tagRoutes, { prefix: '/api/v1/tags' });
await app.ready();

afterAll(async () => {
  await app.close();
  await owner.tag.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { id: agent.id } });
  await owner.role.deleteMany({ where: { id: role.id } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

test('列表只有自己租戶的標籤', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/tags' });

  assert.equal(res.statusCode, 200);
  const ids = (res.json().data as Array<{ id: string; tenantId: string }>).map((t) => t.id);
  assert.ok(ids.includes(ownTag.id));
  assert.ok(!ids.includes(otherTag.id), '列表出現其他租戶的標籤');
});

test('刪除其他租戶的標籤：回 404，該標籤不受影響', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/api/v1/tags/${otherTag.id}` });

  assert.equal(res.statusCode, 404);
  assert.ok(await owner.tag.findUnique({ where: { id: otherTag.id } }), '其他租戶的標籤被刪除');
});

test('刪除自己租戶的標籤：成功', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/api/v1/tags/${ownTag.id}` });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, { deleted: true });
  assert.equal(await owner.tag.findUnique({ where: { id: ownTag.id } }), null);
});
