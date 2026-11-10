/**
 * 月額度提高後可以再次告警（change make-token-topup-monthly，主規格 usage-quota-alerts「月額度提高後可以再次告警」，AUDIT PLAN-13）。
 *
 * 會提高 AI 月額度的操作：核准升級、平台改租戶方案、試用轉付費、平台改方案的 limits。
 * 上限提高時要刪除本月的告警旗標，上限不變或降低時保留。
 * Prisma 與 Redis 換成記憶體版本，Redis 保留 NX 的行為，才能驗證告警旗標有沒有被清除。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { Redis } from 'ioredis';
import { taipeiMonthString } from '@open333crm/core';
import { approveRequest } from '#src/modules/platform/plan-change.service.js';
import { updateTenant } from '#src/modules/platform/platform-tenant.service.js';
import { convertToPaid } from '#src/modules/platform/trial-admin.service.js';
import { updatePlan } from '#src/modules/platform/plan.service.js';
import { getEffectiveLimit } from '#src/modules/platform/plan-limits.service.js';
import { claimCrossedThresholds } from '#src/modules/trial/token-quota.service.js';

const REVIEWER = '99999999-9999-4999-8999-999999999999';

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** 只實作用到的 Redis 指令；SET 支援 NX */
function memRedis() {
  const store = new Map<string, string>();
  const redis = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string | number, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, String(value));
      return 'OK';
    },
    del: async (...keys: string[]) => keys.filter((key) => store.delete(key)).length,
    exists: async (key: string) => (store.has(key) ? 1 : 0),
    scan: async () => ['0', []],
  };
  return { redis: redis as unknown as Redis, store };
}

interface PlanRow { id: string; slug: string; name: string; limits: Record<string, number | null> }
interface TenantRow {
  id: string;
  name: string;
  isActive: boolean;
  planId: string | null;
  trialEndsAt: Date | null;
  limitOverrides: Record<string, number | null>;
}

/** 只實作換方案的四個入口與 getEffectiveLimit 用到的 Prisma 方法 */
function createDb() {
  const plans = new Map<string, PlanRow>();
  const tenants = new Map<string, TenantRow>();
  const requests: Array<Record<string, unknown> & { id: string }> = [];
  const withPlan = (t: TenantRow) => ({ ...t, plan: t.planId ? plans.get(t.planId)! : null });

  const prisma = {
    plan: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
        const plan = [...plans.values()].find((p) => (where.id ? p.id === where.id : p.slug === where.slug));
        // 回傳複本：更新方案之後，呼叫端先前讀到的舊 limits 不會跟著變
        return plan ? { ...plan, limits: { ...plan.limits } } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PlanRow> }) => {
        const plan = plans.get(where.id)!;
        Object.assign(plan, data);
        return { ...plan };
      },
    },
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const t = tenants.get(where.id);
        return t ? withPlan(t) : null;
      },
      findMany: async ({ where }: { where: { planId: string } }) =>
        [...tenants.values()].filter((t) => t.planId === where.planId).map(withPlan),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = tenants.get(where.id)!;
        const { plan, ...rest } = data as { plan?: { connect: { id: string } } };
        Object.assign(t, rest);
        if (plan) t.planId = plan.connect.id;
        return withPlan(t);
      },
    },
    planChangeRequest: {
      findUnique: async ({ where }: { where: { id: string } }) => requests.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = requests.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      aggregate: async () => ({ _sum: { topupTokens: null } }),
    },
    platformSetting: { findUnique: async () => null },
  };

  return {
    prisma: prisma as never,
    addPlan(slug: string, monthlyTokens: number | null) {
      const plan: PlanRow = { id: uuid(), slug, name: slug, limits: { monthlyTokens } };
      plans.set(plan.id, plan);
      return plan;
    },
    addTenant(planId: string, limitOverrides: Record<string, number | null> = {}, trialEndsAt: Date | null = null) {
      const t: TenantRow = { id: uuid(), name: '租戶', isActive: true, planId, trialEndsAt, limitOverrides };
      tenants.set(t.id, t);
      return t;
    },
    addUpgrade(tenantId: string, targetPlanSlug: string) {
      const row = { id: uuid(), tenantId, type: 'upgrade', targetPlanSlug, status: 'pending' };
      requests.push(row);
      return row;
    },
  };
}

const flagKey = (tenantId: string, level: 'warning' | 'critical') =>
  `aiquota-alert:${tenantId}:${taipeiMonthString(new Date())}:${level}`;

test('升級方案後再次跨越門檻：本月已發過 warning 與 critical，升級到 3,000,000 後跨越新上限的 80% 再次告警', async () => {
  const db = createDb();
  const { redis } = memRedis();
  const light = db.addPlan('light', 1_500_000);
  db.addPlan('standard', 3_000_000);
  const tenant = db.addTenant(light.id);
  // 用量從 1,100,000 一次累加到 1,500,000：同時跨越 80% 與 100%
  const first = await claimCrossedThresholds(redis, tenant.id, 1_500_000, 400_000, 1_500_000);
  assert.deepEqual(first.map((c) => c.level), ['warning', 'critical']);
  const req = db.addUpgrade(tenant.id, 'standard');

  await approveRequest(db.prisma, redis, req.id, REVIEWER);

  const limit = await getEffectiveLimit(db.prisma, tenant.id, 'monthlyTokens');
  const crossed = await claimCrossedThresholds(redis, tenant.id, limit, 10_000, 2_400_000);
  assert.deepEqual(crossed.map((c) => [c.level, c.limitTokens]), [['warning', 3_000_000]]);
});

test('平台變更租戶方案或試用轉付費後再次告警：改到 monthlyTokens 100,000 的方案，本月的 warning 旗標被刪除', async () => {
  const db = createDb();
  const { redis, store } = memRedis();
  const trial = db.addPlan('trial-small', 1_000);
  db.addPlan('paid', 100_000);
  const edited = db.addTenant(trial.id);
  const converted = db.addTenant(trial.id, {}, new Date(Date.now() + 86_400_000));
  for (const t of [edited, converted]) store.set(flagKey(t.id, 'warning'), '1');

  await updateTenant(db.prisma, redis, edited.id, { planSlug: 'paid' });
  await convertToPaid(db.prisma, redis, converted.id, 'paid');

  assert.equal(store.has(flagKey(edited.id, 'warning')), false, '平台改租戶方案');
  assert.equal(store.has(flagKey(converted.id, 'warning')), false, '試用轉付費');
});

test('平台調高方案額度後再次告警：方案改成 400,000，沒有覆寫的甲旗標被刪除，覆寫 500,000 的乙保留', async () => {
  const db = createDb();
  const { redis, store } = memRedis();
  const plan = db.addPlan('light', 200_000);
  const a = db.addTenant(plan.id);
  const b = db.addTenant(plan.id, { monthlyTokens: 500_000 });
  for (const t of [a, b]) store.set(flagKey(t.id, 'warning'), '1');

  await updatePlan(db.prisma, redis, plan.id, { limits: { monthlyTokens: 400_000 } });

  assert.equal(store.has(flagKey(a.id, 'warning')), false, '甲：基礎上限從 200,000 提高到 400,000');
  assert.equal(store.has(flagKey(b.id, 'warning')), true, '乙：覆寫值不變，上限沒有提高');
});

test('降級不刪除告警紀錄：從 3,000,000 改到 1,500,000 的方案，本月的 warning 旗標保留', async () => {
  const db = createDb();
  const { redis, store } = memRedis();
  const standard = db.addPlan('standard', 3_000_000);
  const light = db.addPlan('light', 1_500_000);
  const edited = db.addTenant(standard.id);
  const upgraded = db.addTenant(standard.id);
  const lowered = db.addTenant(standard.id);
  for (const t of [edited, upgraded, lowered]) store.set(flagKey(t.id, 'warning'), '1');

  await updateTenant(db.prisma, redis, edited.id, { planSlug: 'light' });
  await approveRequest(db.prisma, redis, db.addUpgrade(upgraded.id, 'light').id, REVIEWER);
  // 方案本身調低：standard 的額度改成 2,000,000
  await updatePlan(db.prisma, redis, standard.id, { limits: { monthlyTokens: 2_000_000 } });

  assert.equal(store.has(flagKey(edited.id, 'warning')), true, '平台改到較低的方案');
  assert.equal(store.has(flagKey(upgraded.id, 'warning')), true, '核准改到較低的方案');
  assert.equal(store.has(flagKey(lowered.id, 'warning')), true, '方案調低額度');
  assert.equal(light.limits.monthlyTokens, 1_500_000);
});
