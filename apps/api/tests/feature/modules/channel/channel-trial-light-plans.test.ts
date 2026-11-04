/**
 * 試用與輕量版方案可以使用渠道（issue #411，change enable-channels-on-trial-light-411，
 * spec tenant-plan「Plan 全域資料模型」）。
 *
 * 方案內容取自 seed（packages/database/prisma/seed-data/plans.ts），以 seed 同內容的方案建立
 * 專用租戶，走真實的 requirePermission、方案天花板、Redis 權限快取與 app_tenant 連線（RLS）。
 * 租戶管理員的角色含 channel.view、channel.create；方案不含 channels 時兩者都被天花板擋下（403）。
 * 屬於 feature 組：資料加標記並在 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';
import { SEED_PLANS } from '../../../../../../packages/database/prisma/seed-data/plans.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-trial-light-channels-${Date.now()}`;
const ADMIN_PERMISSIONS = ['channel.view', 'channel.create', 'channel.update', 'channel.view_all'];

type Fixture = { planId: string; tenantId: string; agentId: string; roleId: string };
const fixtures: Fixture[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];

/** 以 seed 同內容的方案建立租戶與管理員 */
async function setupTenantOnSeedPlan(slug: 'trial' | 'light'): Promise<Fixture> {
  const seedPlan = SEED_PLANS.find((p) => p.slug === slug);
  assert.ok(seedPlan, `seed 應有 ${slug} 方案`);
  const key = `${MARK}-${slug}-${fixtures.length}`;
  const plan = await owner.plan.create({
    data: { slug: key, name: seedPlan.name, features: seedPlan.features, limits: seedPlan.limits },
  });
  const tenant = await owner.tenant.create({ data: { name: key, planId: plan.id } });
  const role = await owner.role.create({
    data: {
      tenantId: tenant.id,
      slug: `${key}-admin`,
      name: `${key}-admin`,
      permissions: { create: ADMIN_PERMISSIONS.map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: {
      tenantId: tenant.id,
      roleId: role.id,
      role: 'ADMIN',
      name: MARK,
      email: `${key}@example.test`,
      passwordHash: 'x',
    },
  });
  const fixture = { planId: plan.id, tenantId: tenant.id, agentId: agent.id, roleId: role.id };
  fixtures.push(fixture);
  return fixture;
}

async function buildApp(f: Fixture) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: f.agentId, tenantId: f.tenantId, role: 'ADMIN', roleId: f.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, f.tenantId);
  });
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.ready();
  apps.push(app);
  return app;
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  for (const f of fixtures) {
    const channels = await owner.channel.findMany({ where: { tenantId: f.tenantId }, select: { id: true } });
    const channelIds = channels.map((c) => c.id);
    await owner.agentChannelAccess.deleteMany({ where: { channelId: { in: channelIds } } });
    await owner.channel.deleteMany({ where: { tenantId: f.tenantId } });
    await owner.tenantAuditLog.deleteMany({ where: { tenantId: f.tenantId } });
    await owner.agent.deleteMany({ where: { tenantId: f.tenantId } });
    await owner.role.deleteMany({ where: { tenantId: f.tenantId } });
    await owner.tenant.delete({ where: { id: f.tenantId } });
    await owner.plan.delete({ where: { id: f.planId } });
  }
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

for (const slug of ['trial', 'light'] as const) {
  test(`試用與輕量版方案可以使用渠道：${slug} 方案的管理員列出渠道回 200`, async () => {
    const f = await setupTenantOnSeedPlan(slug);
    await owner.channel.create({
      data: { tenantId: f.tenantId, channelType: 'WEBCHAT', displayName: `${MARK}-${slug}-existing`, credentialsEncrypted: 'x' },
    });
    const app = await buildApp(f);

    const res = await app.inject({ method: 'GET', url: '/api/v1/channels' });
    assert.equal(res.statusCode, 200, res.body);
    const names = (res.json().data as Array<{ displayName: string }>).map((c) => c.displayName);
    assert.deepEqual(names, [`${MARK}-${slug}-existing`]);
  });

  test(`試用與輕量版方案可以使用渠道：${slug} 方案的管理員建立渠道回 201`, async () => {
    const f = await setupTenantOnSeedPlan(slug);
    const app = await buildApp(f);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/channels',
      payload: { channelType: 'WEBCHAT', displayName: `${MARK}-${slug}-new`, credentials: {} },
    });
    assert.equal(res.statusCode, 201, res.body);
    const stored = await owner.channel.findFirst({ where: { tenantId: f.tenantId, id: res.json().data.id } });
    assert.equal(stored?.displayName, `${MARK}-${slug}-new`);
  });
}
