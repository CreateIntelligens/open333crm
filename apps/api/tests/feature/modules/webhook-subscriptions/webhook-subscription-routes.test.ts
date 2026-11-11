/**
 * Webhook 訂閱管理的路由（#337 階段 3 搬遷前後行為相同）：建立、列表、查詢、修改、刪除、送出紀錄，
 * 以及其他租戶的成員對同一筆訂閱一律回 404。
 *
 * 走真實的 requirePermission 與 app_tenant 連線（RLS）。網址的 SSRF 檢查以 mock 的 DNS 放行，
 * 由 webhook-subscription-egress.test.ts 檢查。建立的訂閱與角色、成員在 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import webhookSubscriptionRoutes from '#src/modules/webhook-subscriptions/webhook-subscription.routes.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return { ...actual, lookup: (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof actual.lookup };
});

loadEnvConfig();
const owner = new PrismaClient();
const tenantClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT! } } });
const stamp = Date.now();

async function makeAgent(tenantId: string) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `ci-webhook-sub-${stamp}-${tenantId.slice(0, 1)}`,
      name: 'CI Webhook',
      permissions: { create: ['webhook.view', 'webhook.manage'].map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, email: `ci-webhook-sub-${stamp}-${role.id}@example.test`, name: 'CI Webhook', passwordHash: 'x', roleId: role.id },
  });
  return { tenantId, roleId: role.id, agentId: agent.id };
}

const adminA = await makeAgent(TENANT_A);
const adminB = await makeAgent(TENANT_B);
const actors = [adminA, adminB];

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantClient);
app.decorate('prismaAdmin', owner);
app.decorate('authenticate', async (request: FastifyRequest) => {
  const actor = actors.find((a) => a.agentId === request.headers['x-test-agent'])!;
  request.agent = { id: actor.agentId, tenantId: actor.tenantId, role: 'AGENT', roleId: actor.roleId } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantClient, actor.tenantId);
});
await app.register(webhookSubscriptionRoutes, { prefix: '/api/v1/webhook-subscriptions' });
await app.ready();

const call = (actor: { agentId: string }, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/webhook-subscriptions${url}`, headers: { 'x-test-agent': actor.agentId }, payload });

const URL_A = `https://hooks.example.test/${stamp}`;

afterAll(async () => {
  await app.close();
  await owner.webhookSubscription.deleteMany({ where: { url: { startsWith: URL_A } } });
  await owner.agent.deleteMany({ where: { id: { in: actors.map((a) => a.agentId) } } });
  await owner.role.deleteMany({ where: { id: { in: actors.map((a) => a.roleId) } } });
  await owner.$disconnect();
  await tenantClient.$disconnect();
});

test('建立、列表、查詢、修改、送出紀錄、刪除', async () => {
  const created = await call(adminA, 'POST', '/', { url: URL_A, events: ['message.received'] });
  assert.equal(created.statusCode, 201, created.body);
  const sub = created.json().data;
  assert.equal(sub.tenantId, TENANT_A);
  assert.equal(sub.isActive, true);
  assert.equal(typeof sub.secret, 'string');

  const list = await call(adminA, 'GET', '/');
  assert.equal(list.statusCode, 200, list.body);
  const listed = list.json().data.find((s: { id: string }) => s.id === sub.id);
  assert.equal(listed?._count.deliveries, 0);

  assert.equal((await call(adminA, 'GET', `/${sub.id}`)).json().data.url, URL_A);

  const patched = await call(adminA, 'PATCH', `/${sub.id}`, { isActive: false, url: `${URL_A}/v2` });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(patched.json().data.isActive, false);
  assert.equal(patched.json().data.url, `${URL_A}/v2`);

  const deliveries = await call(adminA, 'GET', `/${sub.id}/deliveries`);
  assert.equal(deliveries.statusCode, 200, deliveries.body);
  assert.deepEqual(deliveries.json().data, []);

  const deleted = await call(adminA, 'DELETE', `/${sub.id}`);
  assert.deepEqual(deleted.json().data, { deleted: true });
  assert.equal((await call(adminA, 'GET', `/${sub.id}`)).statusCode, 404);
});

test('其他租戶的成員查詢、修改、刪除、看送出紀錄都回 404，訂閱不變', async () => {
  const sub = (await call(adminA, 'POST', '/', { url: `${URL_A}/iso`, events: ['message.received'] })).json().data;

  assert.equal((await call(adminB, 'GET', `/${sub.id}`)).statusCode, 404);
  assert.equal((await call(adminB, 'PATCH', `/${sub.id}`, { isActive: false })).statusCode, 404);
  assert.equal((await call(adminB, 'GET', `/${sub.id}/deliveries`)).statusCode, 404);
  assert.equal((await call(adminB, 'DELETE', `/${sub.id}`)).statusCode, 404);
  const listB = (await call(adminB, 'GET', '/')).json().data as Array<{ id: string }>;
  assert.equal(listB.some((s) => s.id === sub.id), false);

  const after = (await call(adminA, 'GET', `/${sub.id}`)).json().data;
  assert.equal(after.isActive, true);
});
