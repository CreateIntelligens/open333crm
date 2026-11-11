/**
 * GET /channels/:id/status 依權限與渠道可見範圍守門。
 * 權限註冊表寫明 channel.view 涵蓋 status；修正前這條路由只驗登入，
 * 沒有渠道權限、或看不到該渠道的成員，也能查渠道是否啟用與 FB 權杖狀態。
 *
 * 屬於 feature 組：走真實路由、權限計算與 app_tenant 連線，資料加標記並在 afterAll 刪除。
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
const MARK = `ci-channel-status-${Date.now()}`;

const createRole = (slug: string, codes: string[]) =>
  owner.role.create({
    data: {
      tenantId: A,
      slug: `${MARK}-${slug}`,
      name: `${MARK}-${slug}`,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
const noChannelRole = await createRole('none', ['inbox.view']);
const viewRole = await createRole('view', ['channel.view']);

const createAgent = (slug: string, roleId: string) =>
  owner.agent.create({ data: { tenantId: A, roleId, email: `${MARK}-${slug}@example.test`, name: MARK, passwordHash: 'x' } });
const noChannelAgent = await createAgent('none', noChannelRole.id);
const viewer = await createAgent('viewer', viewRole.id);
const other = await createAgent('other', viewRole.id);

const createChannel = (slug: string) =>
  owner.channel.create({
    data: { tenantId: A, channelType: 'WEBCHAT', isActive: true, displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });
const visible = await createChannel('visible');
const hidden = await createChannel('hidden');
await owner.agentChannelAccess.create({ data: { channelId: visible.id, agentId: viewer.id, accessLevel: 'read_only' } });
await owner.agentChannelAccess.create({ data: { channelId: visible.id, agentId: noChannelAgent.id, accessLevel: 'full' } });
await owner.agentChannelAccess.create({ data: { channelId: hidden.id, agentId: other.id, accessLevel: 'full' } });

const apps: Array<{ close: () => Promise<unknown> }> = [];
async function buildApp(agent: { id: string; roleId: string | null }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', owner);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.ready();
  apps.push(app);
  return app;
}
const noChannelApp = await buildApp(noChannelAgent);
const viewerApp = await buildApp(viewer);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  const channelIds = [visible.id, hidden.id];
  await owner.agentChannelAccess.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const status = (app: Awaited<ReturnType<typeof buildApp>>, channelId: string) =>
  app.inject({ method: 'GET', url: `/api/v1/channels/${channelId}/status` });

test('沒有 channel.view：回 403，錯誤指出缺少 channel.view', async () => {
  const res = await status(noChannelApp as never, visible.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'channel.view');
});

test('有 channel.view、渠道看得到：回 200 與渠道狀態', async () => {
  const res = await status(viewerApp as never, visible.id);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.isActive, true);
});

test('有 channel.view、渠道看不到：回 404，不回渠道狀態', async () => {
  const res = await status(viewerApp as never, hidden.id);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().data, undefined);
});
