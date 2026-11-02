/**
 * `/channels/:id/binding-handle` 的 id 不是 UUID 時回 400（issue #253 測試缺口，原 add-cross-channel-one-id 9.6）。
 * 沒有這個檢查時 id 會直接進資料庫查詢，PostgreSQL 的 uuid 轉型失敗變成 500（以突變驗證）。
 *
 * 屬於 feature 組：走真實路由、權限計算與 app_tenant 連線。資料加標記並在 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-binding-handle-${Date.now()}`;
const MISSING_ID = '00000000-0000-4000-8000-00000000beef';

const role = await owner.role.create({
  data: {
    tenantId: A,
    slug: MARK,
    name: MARK,
    permissions: { create: ['channel.view', 'channel.update', 'channel.view_all'].map((permissionCode) => ({ permissionCode })) },
  },
});
const agent = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}@example.test`, name: MARK, passwordHash: 'x' },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', owner);
app.decorate('prismaAdmin', owner);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
});
await app.register(channelRoutes, { prefix: '/api/v1/channels' });
await app.ready();

afterAll(async () => {
  await app.close();
  await owner.agent.deleteMany({ where: { id: agent.id, tenantId: A } });
  await owner.role.deleteMany({ where: { id: role.id } });
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

test('binding-handle 的 id 不是 UUID：GET 與 PATCH 都回 400 VALIDATION_ERROR，不是 500', async () => {
  for (const method of ['GET', 'PATCH'] as const) {
    const res = await app.inject({
      method,
      url: '/api/v1/channels/not-a-uuid/binding-handle',
      ...(method === 'PATCH' ? { payload: { bindingHandle: '@abc1234' } } : {}),
    });
    assert.equal(res.statusCode, 400, `${method}：${res.body}`);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR', `${method}：${res.body}`);
  }
});

test('binding-handle 的 id 是 UUID 但渠道不存在：回 404', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/channels/${MISSING_ID}/binding-handle` });
  assert.equal(res.statusCode, 404, res.body);
});
