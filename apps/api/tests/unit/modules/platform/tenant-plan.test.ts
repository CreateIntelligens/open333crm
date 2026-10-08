/**
 * 方案的功能天花板、方案管理與平台變更租戶的方案（主規格 tenant-plan）。
 * Redis 換成記憶體版本，保留快取行為，才能驗證快取有沒有被清除。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { test, vi } from 'vitest';

const cache = vi.hoisted(() => new Map<string, string>());
vi.mock('@open333crm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open333crm/core')>();
  const globToRegExp = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return {
    ...actual,
    redis: {
      get: async (key: string) => cache.get(key) ?? null,
      set: async (key: string, value: string) => {
        cache.set(key, value);
        return 'OK';
      },
      del: async (...keys: string[]) => keys.filter((key) => cache.delete(key)).length,
      scan: async (_cursor: string, _match: string, pattern: string) => {
        const re = globToRegExp(pattern);
        return ['0', [...cache.keys()].filter((key) => re.test(key))];
      },
    },
  };
});

import { getEffectiveTenantPermissions } from '#src/services/permission.service.js';
import { getTenantPlanId } from '#src/services/tenant-plan.cache.js';
import { requirePermission } from '#src/guards/rbac.guard.js';
import { updatePlan } from '#src/modules/platform/plan.service.js';
import { updateTenant } from '#src/modules/platform/platform-tenant.service.js';
import { getEffectiveLimit } from '#src/modules/platform/plan-limits.service.js';

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  features: string[];
  limits: Record<string, number | null>;
  permissionOverrides: { deny?: string[] };
}

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** 只實作這些函式用到的 Prisma 方法 */
function createDb() {
  const plans = new Map<string, PlanRow>();
  const tenants = new Map<string, { id: string; name: string; planId: string | null; limitOverrides: Record<string, number | null> }>();
  const rolePermissions: Array<{ roleId: string; permissionCode: string }> = [];

  const findPlan = (where: { id?: string; slug?: string }) =>
    [...plans.values()].find((p) => (where.id ? p.id === where.id : p.slug === where.slug)) ?? null;

  const prisma = {
    plan: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => findPlan(where),
      update: async ({ where, data }: { where: { id: string }; data: Partial<PlanRow> }) => {
        const plan = { ...plans.get(where.id)!, ...data };
        plans.set(plan.id, plan);
        return plan;
      },
    },
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const tenant = tenants.get(where.id);
        if (!tenant) return null;
        const plan = tenant.planId ? plans.get(tenant.planId)! : null;
        return { ...tenant, plan };
      },
      update: async ({ where, data }: { where: { id: string }; data: { name?: string; plan?: { connect: { id: string } } } }) => {
        const tenant = tenants.get(where.id)!;
        if (data.name !== undefined) tenant.name = data.name;
        if (data.plan) tenant.planId = data.plan.connect.id;
        const plan = tenant.planId ? plans.get(tenant.planId)! : null;
        return { id: tenant.id, name: tenant.name, isActive: true, plan: plan && { slug: plan.slug, name: plan.name } };
      },
    },
    rolePermission: {
      findMany: async ({ where }: { where: { roleId: string } }) =>
        rolePermissions.filter((row) => row.roleId === where.roleId).map(({ permissionCode }) => ({ permissionCode })),
      // 讓「降級時刪除角色權限」的突變可以執行
      deleteMany: async ({ where }: { where: { permissionCode: { in: string[] } } }) => {
        const kept = rolePermissions.filter((row) => !where.permissionCode.in.includes(row.permissionCode));
        const count = rolePermissions.length - kept.length;
        rolePermissions.splice(0, rolePermissions.length, ...kept);
        return { count };
      },
    },
  };

  return {
    prisma: prisma as never,
    rolePermissions,
    addPlan(slug: string, features: string[], limits: Record<string, number | null> = {}) {
      const plan: PlanRow = { id: uuid(), slug, name: slug, features, limits, permissionOverrides: {} };
      plans.set(plan.id, plan);
      return plan;
    },
    addTenant(planId: string | null) {
      const tenant = { id: uuid(), name: 'tenant', planId, limitOverrides: {} };
      tenants.set(tenant.id, tenant);
      return tenant;
    },
    addRole(codes: string[]) {
      const roleId = uuid();
      for (const permissionCode of codes) rolePermissions.push({ roleId, permissionCode });
      return roleId;
    },
  };
}

/** 依租戶目前的方案取得成員的有效權限，與 requirePermission 的讀法相同 */
async function memberPermissions(db: ReturnType<typeof createDb>, tenantId: string, roleId: string) {
  const planId = await getTenantPlanId(db.prisma, tenantId);
  return getEffectiveTenantPermissions(db.prisma, roleId, planId);
}

test('trial 方案未含 marketing：有效權限不含 marketing.view，requirePermission 回 403', async () => {
  const db = createDb();
  const trial = db.addPlan('trial', ['inbox', 'knowledge', 'core']);
  const tenant = db.addTenant(trial.id);
  const roleId = db.addRole(['marketing.view', 'contact.view']);

  const effective = await memberPermissions(db, tenant.id, roleId);
  assert.equal(effective.has('marketing.view'), false);
  assert.equal(effective.has('contact.view'), true);

  const app = Fastify();
  app.decorate('prismaAdmin', db.prisma);
  app.decorateRequest('agent', null);
  app.addHook('preHandler', async (request) => {
    (request as unknown as { agent: unknown }).agent = { id: 'agent-1', tenantId: tenant.id, roleId, role: 'ADMIN' };
  });
  app.get('/marketing', { preHandler: requirePermission('marketing.view') }, async () => ({ ok: true }));
  const res = await app.inject({ method: 'GET', url: '/marketing' });
  await app.close();

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.details.requiredPermission, 'marketing.view');
});

test('無 plan 租戶不受影響：有效權限與角色權限相同', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);
  const roleId = db.addRole(['marketing.view', 'analytics.view']);

  const effective = await memberPermissions(db, tenant.id, roleId);
  assert.deepEqual([...effective].sort(), ['analytics.view', 'marketing.view']);
});

test('平台改 plan features 即時生效：移除 knowledge 後，有效權限不再含知識庫的權限碼', async () => {
  const db = createDb();
  const trial = db.addPlan('trial', ['inbox', 'knowledge', 'core']);
  const tenant = db.addTenant(trial.id);
  const roleId = db.addRole(['knowledge.view', 'contact.view']);

  assert.equal((await memberPermissions(db, tenant.id, roleId)).has('knowledge.view'), true);

  await updatePlan(db.prisma, trial.id, { features: ['inbox', 'core'] });

  const effective = await memberPermissions(db, tenant.id, roleId);
  assert.equal(effective.has('knowledge.view'), false);
  assert.equal(effective.has('contact.view'), true);
});

test('方案的 features 不含 core：有效權限仍含 role.manage', async () => {
  const db = createDb();
  const plan = db.addPlan('inbox-only', ['inbox']);
  const tenant = db.addTenant(plan.id);
  const roleId = db.addRole(['role.manage', 'contact.view']);

  const effective = await memberPermissions(db, tenant.id, roleId);
  assert.equal(effective.has('role.manage'), true);
  assert.equal(effective.has('contact.view'), true);
});

test('更新 limits：方案的 maxAgents 從 3 改為 5，沒有覆寫的租戶的有效上限變為 5', async () => {
  const db = createDb();
  const trial = db.addPlan('trial', ['core'], { maxAgents: 3 });
  const tenant = db.addTenant(trial.id);
  assert.equal(await getEffectiveLimit(db.prisma, tenant.id, 'maxAgents'), 3);

  await updatePlan(db.prisma, trial.id, { limits: { maxAgents: 5 } });

  assert.equal(await getEffectiveLimit(db.prisma, tenant.id, 'maxAgents'), 5);
});

test('變更方案後立即生效：API 讀過舊方案之後，下一次讀到新方案', async () => {
  const db = createDb();
  const light = db.addPlan('light', ['inbox', 'core']);
  const standard = db.addPlan('standard', ['inbox', 'channels', 'core']);
  const tenant = db.addTenant(light.id);
  assert.equal(await getTenantPlanId(db.prisma, tenant.id), light.id);

  await updateTenant(db.prisma, tenant.id, { planSlug: 'standard' });

  assert.equal(await getTenantPlanId(db.prisma, tenant.id), standard.id);
});

test('降級不刪除角色的權限設定：有效權限不含 marketing.view，RolePermission 仍然保留', async () => {
  const db = createDb();
  db.addPlan('professional', ['inbox', 'marketing', 'core']);
  const light = db.addPlan('light', ['inbox', 'core']);
  const tenant = db.addTenant(light.id);
  await updateTenant(db.prisma, tenant.id, { planSlug: 'professional' });
  const roleId = db.addRole(['marketing.view']);
  assert.equal((await memberPermissions(db, tenant.id, roleId)).has('marketing.view'), true);

  await updateTenant(db.prisma, tenant.id, { planSlug: 'light' });

  assert.equal((await memberPermissions(db, tenant.id, roleId)).has('marketing.view'), false);
  assert.deepEqual(db.rolePermissions.filter((row) => row.roleId === roleId).map((row) => row.permissionCode), ['marketing.view']);
});

test('升回原方案後恢復權限：有效權限再次含 marketing.view，角色不需要重新設定', async () => {
  const db = createDb();
  const professional = db.addPlan('professional', ['inbox', 'marketing', 'core']);
  db.addPlan('light', ['inbox', 'core']);
  const tenant = db.addTenant(professional.id);
  const roleId = db.addRole(['marketing.view']);
  assert.equal((await memberPermissions(db, tenant.id, roleId)).has('marketing.view'), true);
  await updateTenant(db.prisma, tenant.id, { planSlug: 'light' });
  assert.equal((await memberPermissions(db, tenant.id, roleId)).has('marketing.view'), false);

  await updateTenant(db.prisma, tenant.id, { planSlug: 'professional' });
  // 清掉快取：權限要來自角色仍然保留的設定，不是降級前留下的快取
  cache.clear();

  assert.equal((await memberPermissions(db, tenant.id, roleId)).has('marketing.view'), true);
});
