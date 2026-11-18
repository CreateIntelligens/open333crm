/**
 * 留言自動私訊的方案 feature（change add-comment-keyword-private-reply，tasks 9.3，design D23）。
 *
 * - 「部署後既有方案都不含」：不寫方案資料 migration，seed 的方案與資料庫內的方案都不含 comment_reply
 * - `/platform/registry` 動態提供 comment_reply 與兩個權限點（平台在 /admin/plans 勾選）
 * - 平台在方案勾選 comment_reply 後，租戶的權限天花板放行（PATCH /plans/:id 失效 perms:tenant 快取）
 *
 * 走真實的 platform.routes、updatePlan、getEffectiveTenantPermissions、測試資料庫與測試 Redis。
 * 平台認證換成固定的平台帳號（租戶 JWT 被拒絕由 platform-auth-guard.test.ts 檢查）。
 * 方案、租戶、角色、平台帳號都帶 stamp，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import platformRoutes from '#src/modules/platform/platform.routes.js';
import { getEffectiveTenantPermissions } from '#src/services/permission.service.js';
import { SEED_PLANS } from '../../../../../../packages/database/prisma/seed-data/plans.js';

loadEnvConfig();

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
const stamp = `cr-plan-${Date.now()}`;

const platformUser = await prisma.platformUser.create({
  data: { email: `${stamp}@example.test`, name: 'CI 留言私訊方案測試', passwordHash: 'x' },
});

const app = Fastify();
app.decorate('prismaAdmin', prisma as never);
app.decorate('redis', redis as never);
app.decorateRequest('platformUser', null);
app.decorate('authenticatePlatformSuperuser', async (req: { platformUser: unknown }) => {
  req.platformUser = { id: platformUser.id, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
});
await app.register(errorHandlerPlugin);
await app.register(platformRoutes, { prefix: '/api/v1/platform' });
await app.ready();

const planIds: string[] = [];
const tenantIds: string[] = [];

afterAll(async () => {
  await app.close();
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.platformAuditLog.deleteMany({ where: { platformUserId: platformUser.id } });
  await prisma.platformUser.delete({ where: { id: platformUser.id } });
  await redis.quit();
  await prisma.$disconnect();
});

test('部署後既有方案都不含：seed 方案與資料庫內的方案都沒有 comment_reply', async () => {
  for (const p of SEED_PLANS) {
    assert.equal((p.features as string[]).includes('comment_reply'), false, `seed 方案 ${p.slug} 不該含 comment_reply`);
  }
  const plans = await prisma.plan.findMany({ where: { id: { notIn: planIds } }, select: { slug: true, features: true } });
  for (const p of plans) {
    const features = Array.isArray(p.features) ? (p.features as string[]) : [];
    assert.equal(features.includes('comment_reply'), false, `方案 ${p.slug} 不該含 comment_reply`);
  }
});

test('/platform/registry 回傳 comment_reply 與兩個權限點', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/platform/registry' });
  assert.equal(res.statusCode, 200, res.body);
  const features = res.json().data.features as Array<{ slug: string; label: string; core: boolean; perms: { code: string }[] }>;
  const f = features.find((x) => x.slug === 'comment_reply');
  assert.ok(f, 'registry 要有 comment_reply');
  assert.equal(f.label, '留言自動私訊');
  assert.equal(f.core, false);
  assert.deepEqual(f.perms.map((p) => p.code).sort(), ['comment_reply.manage', 'comment_reply.view']);
});

test('平台在方案勾選 comment_reply 後，租戶的權限天花板放行', async () => {
  const plan = await prisma.plan.create({ data: { slug: stamp, name: stamp, features: ['inbox'] } });
  planIds.push(plan.id);
  const tenant = await prisma.tenant.create({ data: { name: stamp, planId: plan.id } });
  tenantIds.push(tenant.id);
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      slug: 'supervisor',
      name: 'Supervisor',
      isSystem: true,
      permissions: { create: [{ permissionCode: 'comment_reply.view' }, { permissionCode: 'comment_reply.manage' }] },
    },
  });

  // 勾選前：方案沒有 comment_reply，天花板濾掉（同時把結果寫進 perms:tenant 快取）
  const before = await getEffectiveTenantPermissions(prisma, redis, role.id, plan.id);
  assert.equal(before.has('comment_reply.view'), false);
  assert.equal(before.has('comment_reply.manage'), false);

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/platform/plans/${plan.id}`,
    payload: { features: ['inbox', 'comment_reply'] },
  });
  assert.equal(res.statusCode, 200, res.body);

  // 勾選後：快取已失效，重新計算的天花板放行
  const after = await getEffectiveTenantPermissions(prisma, redis, role.id, plan.id);
  assert.equal(after.has('comment_reply.view'), true);
  assert.equal(after.has('comment_reply.manage'), true);
});
