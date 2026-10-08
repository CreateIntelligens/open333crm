/**
 * 方案異動申請：租戶送出與查詢、平台查詢待審、核准與駁回（主規格 plan-change-request），
 * 以及核准加購後重新計算用量告警（主規格 usage-quota-alerts「每個門檻每月最多告警一次」）。
 *
 * Prisma 與 Redis 換成記憶體版本。Redis 保留快取與 NX 的行為，才能驗證快取與告警紀錄有沒有被清除。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-plan-change-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@open333crm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open333crm/core')>();
  const globToRegExp = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return {
    ...actual,
    redis: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string | number, ...args: unknown[]) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, String(value));
        return 'OK';
      },
      exists: async (key: string) => (store.has(key) ? 1 : 0),
      incrby: async (key: string, n: number) => {
        const next = Number(store.get(key) ?? 0) + n;
        store.set(key, String(next));
        return next;
      },
      del: async (...keys: string[]) => keys.filter((key) => store.delete(key)).length,
      scan: async (_cursor: string, _match: string, pattern: string) => {
        const re = globToRegExp(pattern);
        return ['0', [...store.keys()].filter((key) => re.test(key))];
      },
    },
  };
});

import { loadEnvConfig } from '#src/config/env.js';
import { getEffectiveTenantPermissions } from '#src/services/permission.service.js';
import { getTenantPlanId } from '#src/services/tenant-plan.cache.js';
import {
  approveRequest,
  createPlanChangeRequest,
  listPendingRequests,
  listTenantPlanChangeRequests,
  rejectRequest,
} from '#src/modules/platform/plan-change.service.js';
import { checkQuotaThresholdCrossing, isMonthlyTokenExceeded } from '#src/modules/trial/token-quota.service.js';
import { AppError } from '#src/shared/utils/response.js';

loadEnvConfig();

const REVIEWER = '99999999-9999-4999-8999-999999999999';

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  features: string[];
  limits: Record<string, number | null>;
  permissionOverrides: { deny?: string[] };
}
interface TenantRow {
  id: string;
  name: string;
  planId: string | null;
  trialEndsAt: Date | null;
  limitOverrides: Record<string, number | null>;
}
interface RequestRow {
  id: string;
  tenantId: string;
  type: string;
  targetPlanSlug: string | null;
  topupTokens: number | null;
  note: string | null;
  status: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** 只實作方案異動、權限、月額度與試用政策用到的 Prisma 方法 */
function createDb() {
  const plans = new Map<string, PlanRow>();
  const tenants = new Map<string, TenantRow>();
  const requests: RequestRow[] = [];
  const rolePermissions: Array<{ roleId: string; permissionCode: string }> = [];
  /** 各租戶本月計入額度的用量，計數器不存在時從這裡補建 */
  const monthlyUsage = new Map<string, number>();
  let clock = Date.UTC(2026, 9, 1);

  const prisma = {
    plan: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) =>
        [...plans.values()].find((p) => (where.id ? p.id === where.id : p.slug === where.slug)) ?? null,
    },
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const tenant = tenants.get(where.id);
        if (!tenant) return null;
        const plan = tenant.planId ? plans.get(tenant.planId)! : null;
        return { ...tenant, limitOverrides: { ...tenant.limitOverrides }, plan };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<TenantRow> }) => {
        const tenant = tenants.get(where.id)!;
        Object.assign(tenant, data);
        return tenant;
      },
    },
    planChangeRequest: {
      findFirst: async ({ where }: { where: { tenantId: string; status: string } }) =>
        requests.find((r) => r.tenantId === where.tenantId && r.status === where.status) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = requests.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where, orderBy, take, include }: {
        where: { tenantId?: string; status?: string };
        orderBy: { createdAt: 'asc' | 'desc' };
        take?: number;
        include?: unknown;
      }) => {
        const rows = requests
          .filter((r) => (where.tenantId === undefined || r.tenantId === where.tenantId)
            && (where.status === undefined || r.status === where.status))
          .sort((a, b) => (orderBy.createdAt === 'asc' ? 1 : -1) * (a.createdAt.getTime() - b.createdAt.getTime()))
          .slice(0, take)
          .map((r) => ({ ...r }));
        if (!include) return rows;
        return rows.map((r) => {
          const tenant = tenants.get(r.tenantId)!;
          const plan = tenant.planId ? plans.get(tenant.planId)! : null;
          return { ...r, tenant: { name: tenant.name, plan: plan && { slug: plan.slug, name: plan.name } } };
        });
      },
      create: async ({ data }: { data: Partial<RequestRow> & { tenantId: string; type: string } }) => {
        const row: RequestRow = {
          id: uuid(),
          targetPlanSlug: null,
          topupTokens: null,
          note: null,
          status: 'pending',
          reviewNote: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: new Date((clock += 1000)),
          ...data,
        };
        requests.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<RequestRow> }) => {
        const row = requests.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    rolePermission: {
      findMany: async ({ where }: { where: { roleId: string } }) =>
        rolePermissions.filter((row) => row.roleId === where.roleId).map(({ permissionCode }) => ({ permissionCode })),
    },
    platformSetting: {
      findUnique: async () => null,
    },
    aiUsage: {
      aggregate: async ({ where }: { where: { tenantId: string } }) => ({
        _sum: { totalTokens: monthlyUsage.get(where.tenantId) ?? 0 },
      }),
    },
  };

  return {
    prisma: prisma as never,
    requests,
    /** 設定租戶本月的用量：資料庫的加總與 Redis 計數器一致 */
    setUsage(tenantId: string, tokens: number) {
      monthlyUsage.set(tenantId, tokens);
      store.set(`aiquota:${tenantId}:${monthKey()}`, String(tokens));
    },
    addPlan(slug: string, features: string[] = ['core'], limits: Record<string, number | null> = {}) {
      const plan: PlanRow = { id: uuid(), slug, name: `${slug} 方案`, features, limits, permissionOverrides: {} };
      plans.set(plan.id, plan);
      return plan;
    },
    removePlan(id: string) {
      plans.delete(id);
    },
    addTenant(planId: string | null, limitOverrides: Record<string, number | null> = {}, name = '租戶') {
      const tenant: TenantRow = { id: uuid(), name, planId, trialEndsAt: null, limitOverrides };
      tenants.set(tenant.id, tenant);
      return tenant;
    },
    tenant(id: string) {
      return tenants.get(id)!;
    },
    addRole(codes: string[]) {
      const roleId = uuid();
      for (const permissionCode of codes) rolePermissions.push({ roleId, permissionCode });
      return roleId;
    },
    /** 直接放一筆申請，用來準備已處理或其他租戶的申請 */
    addRequest(tenantId: string, data: Partial<RequestRow> & { type: string }) {
      const row: RequestRow = {
        id: uuid(),
        tenantId,
        targetPlanSlug: null,
        topupTokens: null,
        note: null,
        status: 'pending',
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: new Date((clock += 1000)),
        ...data,
      };
      requests.push(row);
      return row;
    },
  };
}

type Db = ReturnType<typeof createDb>;

const monthKey = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function rejectsWith(promise: Promise<unknown>, statusCode: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, `應為 AppError，實際是 ${String(err)}`);
    assert.equal(err.statusCode, statusCode);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

/** 租戶側的路由：成員的角色只有 roleCodes 這些權限，租戶沒有方案（不受天花板影響） */
async function tenantApp(db: Db, tenantId: string, roleCodes: string[]) {
  const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
  const { default: planChangeRoutes } = await import('#src/modules/platform/plan-change.routes.js');
  const roleId = db.addRole(roleCodes);
  const app = Fastify();
  app.decorate('prismaAdmin', db.prisma);
  app.decorateRequest('agent', null);
  app.decorate('authenticate', async (request: never) => {
    (request as { agent: unknown }).agent = { id: 'agent-1', tenantId, roleId, role: 'ADMIN' };
  });
  await app.register(errorHandlerPlugin);
  await app.register(planChangeRoutes, { prefix: '/api/v1/plan-change' });
  return app;
}

beforeEach(() => {
  store.clear();
});

// ── 租戶送出方案異動申請 ──

test('送出升級申請：申請是 pending，屬於成員的租戶', async () => {
  const db = createDb();
  db.addPlan('standard');
  const tenant = db.addTenant(null);
  const app = await tenantApp(db, tenant.id, ['settings.manage']);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'upgrade', targetPlanSlug: 'standard', note: '想用行銷功能' },
  });
  await app.close();

  assert.equal(res.statusCode, 200);
  const body = res.json().data;
  assert.equal(body.status, 'pending');
  assert.equal(body.tenantId, tenant.id);
  assert.equal(body.type, 'upgrade');
  assert.equal(body.targetPlanSlug, 'standard');
  assert.equal(db.requests.length, 1);
});

test('已有待審申請時不能再送出：回 409，申請數不變', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);
  db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 100000 });

  await rejectsWith(createPlanChangeRequest(db.prisma, tenant.id, { type: 'token_topup', topupTokens: 200000 }), 409);
  assert.equal(db.requests.length, 1);
});

test('升級申請沒有目標方案：回 400，不建立申請', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);

  await rejectsWith(createPlanChangeRequest(db.prisma, tenant.id, { type: 'upgrade' }), 400);
  assert.equal(db.requests.length, 0);
});

test('目標方案不存在：回 404，不建立申請', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);

  await rejectsWith(createPlanChangeRequest(db.prisma, tenant.id, { type: 'upgrade', targetPlanSlug: 'gold' }), 404);
  assert.equal(db.requests.length, 0);
});

test('加購量不是正整數：0、-1 與 1.5 都回 400，不建立申請', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);
  const app = await tenantApp(db, tenant.id, ['settings.manage']);

  for (const topupTokens of [0, -1, 1.5]) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/plan-change', payload: { type: 'token_topup', topupTokens } });
    assert.equal(res.statusCode, 400, `topupTokens=${topupTokens}`);
  }
  await app.close();
  // 路由的驗證之外，服務本身也拒絕 0（其他呼叫端不經過路由）
  await rejectsWith(createPlanChangeRequest(db.prisma, tenant.id, { type: 'token_topup', topupTokens: 0 }), 400);
  assert.equal(db.requests.length, 0);
});

test('沒有 settings.manage 權限：送出與查詢都回 403', async () => {
  const db = createDb();
  db.addPlan('standard');
  const tenant = db.addTenant(null);
  const app = await tenantApp(db, tenant.id, ['contact.view']);

  const post = await app.inject({ method: 'POST', url: '/api/v1/plan-change', payload: { type: 'upgrade', targetPlanSlug: 'standard' } });
  const get = await app.inject({ method: 'GET', url: '/api/v1/plan-change' });
  await app.close();

  assert.equal(post.statusCode, 403);
  assert.equal(post.json().error.details.requiredPermission, 'settings.manage');
  assert.equal(get.statusCode, 403);
  assert.equal(db.requests.length, 0);
});

// ── 租戶查詢自己的申請 ──

test('只回傳自己租戶的申請：新的在前，不含其他租戶的申請', async () => {
  const db = createDb();
  const a = db.addTenant(null);
  const b = db.addTenant(null);
  const older = db.addRequest(a.id, { type: 'token_topup', topupTokens: 1000, status: 'approved' });
  db.addRequest(b.id, { type: 'token_topup', topupTokens: 2000 });
  const newer = db.addRequest(a.id, { type: 'token_topup', topupTokens: 3000 });
  const app = await tenantApp(db, a.id, ['settings.manage']);

  const res = await app.inject({ method: 'GET', url: '/api/v1/plan-change' });
  await app.close();

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data.map((r: RequestRow) => r.id), [newer.id, older.id]);
});

test('最多回傳 50 筆：租戶有 51 筆申請時，只回傳最新的 50 筆', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);
  const first = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 1, status: 'rejected' });
  for (let i = 0; i < 50; i++) db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 1, status: 'rejected' });

  const rows = await listTenantPlanChangeRequests(db.prisma, tenant.id);
  assert.equal(rows.length, 50);
  assert.ok(!rows.some((r) => r.id === first.id));
});

// ── 平台查詢待審的申請 ──

test('只列出待審的申請：舊的在前，附租戶名稱與目前方案', async () => {
  const db = createDb();
  const light = db.addPlan('light');
  const a = db.addTenant(light.id, {}, '甲租戶');
  const b = db.addTenant(null, {}, '乙租戶');
  const first = db.addRequest(a.id, { type: 'upgrade', targetPlanSlug: 'standard' });
  db.addRequest(a.id, { type: 'token_topup', topupTokens: 1000, status: 'approved' });
  db.addRequest(b.id, { type: 'token_topup', topupTokens: 1000, status: 'rejected' });
  const second = db.addRequest(b.id, { type: 'token_topup', topupTokens: 5000 });

  const rows = await listPendingRequests(db.prisma);
  assert.deepEqual(
    rows.map((r) => [r.id, r.tenantName, r.currentPlan]),
    [
      [first.id, '甲租戶', 'light 方案'],
      [second.id, '乙租戶', null],
    ],
  );
});

// ── 核准升級申請 ──

test('核准升級後立即生效：新方案的權限立即可用，申請記錄審核者、時間與備註', async () => {
  const db = createDb();
  const light = db.addPlan('light', ['inbox', 'core']);
  const standard = db.addPlan('standard', ['inbox', 'marketing', 'core']);
  const tenant = db.addTenant(light.id);
  const roleId = db.addRole(['marketing.view']);
  const permissions = async () =>
    getEffectiveTenantPermissions(db.prisma, roleId, await getTenantPlanId(db.prisma, tenant.id));
  assert.equal((await permissions()).has('marketing.view'), false);
  const req = db.addRequest(tenant.id, { type: 'upgrade', targetPlanSlug: 'standard' });

  const before = Date.now();
  const result = await approveRequest(db.prisma, req.id, REVIEWER, '已收款');

  assert.equal(db.tenant(tenant.id).planId, standard.id);
  assert.equal((await permissions()).has('marketing.view'), true);
  assert.equal(result.status, 'approved');
  assert.equal(result.reviewedBy, REVIEWER);
  assert.equal(result.reviewNote, '已收款');
  assert.ok(result.reviewedAt instanceof Date && result.reviewedAt.getTime() >= before);
});

test('目標方案已不存在：回 404，租戶的方案與申請都不變', async () => {
  const db = createDb();
  const light = db.addPlan('light');
  const gone = db.addPlan('retired');
  const tenant = db.addTenant(light.id);
  const req = db.addRequest(tenant.id, { type: 'upgrade', targetPlanSlug: 'retired' });
  db.removePlan(gone.id);

  await rejectsWith(approveRequest(db.prisma, req.id, REVIEWER), 404);
  assert.equal(db.tenant(tenant.id).planId, light.id);
  assert.equal(db.requests[0]!.status, 'pending');
});

// ── 核准加購申請 ──

test('沒有覆寫時加在方案的額度上：方案 1,000,000，加購 500,000，覆寫值變成 1,500,000', async () => {
  const db = createDb();
  const plan = db.addPlan('light', ['core'], { monthlyTokens: 1_000_000 });
  const tenant = db.addTenant(plan.id);
  const req = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 500_000 });

  const result = await approveRequest(db.prisma, req.id, REVIEWER, '加購一包');

  assert.equal(db.tenant(tenant.id).limitOverrides.monthlyTokens, 1_500_000);
  assert.equal(result.status, 'approved');
  assert.equal(result.reviewedBy, REVIEWER);
  assert.equal(result.reviewNote, '加購一包');
  assert.ok(result.reviewedAt instanceof Date);
});

test('已有覆寫時加在覆寫值上：覆寫 1,200,000，加購 500,000，覆寫值變成 1,700,000', async () => {
  const db = createDb();
  const plan = db.addPlan('light', ['core'], { monthlyTokens: 1_000_000 });
  const tenant = db.addTenant(plan.id, { monthlyTokens: 1_200_000, maxAgents: 8 });
  const req = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 500_000 });

  await approveRequest(db.prisma, req.id, REVIEWER);

  assert.deepEqual(db.tenant(tenant.id).limitOverrides, { monthlyTokens: 1_700_000, maxAgents: 8 });
});

test('有效額度是無上限時不能加購：回 400 TOPUP_UNLIMITED，覆寫值與申請都不變', async () => {
  const db = createDb();
  const plan = db.addPlan('enterprise', ['core'], { monthlyTokens: null });
  const tenant = db.addTenant(plan.id);
  const req = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 500_000 });

  await rejectsWith(approveRequest(db.prisma, req.id, REVIEWER), 400, 'TOPUP_UNLIMITED');
  assert.deepEqual(db.tenant(tenant.id).limitOverrides, {});
  assert.equal(db.requests[0]!.status, 'pending');
});

test('核准加購後立即恢復 AI：用量等於上限時被擋，核准後月額度檢查放行', async () => {
  const db = createDb();
  const plan = db.addPlan('light', ['core'], { monthlyTokens: 1_000_000 });
  const tenant = db.addTenant(plan.id);
  db.setUsage(tenant.id, 1_000_000);
  assert.equal(await isMonthlyTokenExceeded(db.prisma, tenant.id), true);
  const req = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 500_000 });

  await approveRequest(db.prisma, req.id, REVIEWER);

  assert.equal(await isMonthlyTokenExceeded(db.prisma, tenant.id), false);
});

test('核准加購後再次跨越門檻：本月已發過 warning 與 critical，加購後跨越新上限的 80% 時再次告警', async () => {
  const db = createDb();
  const plan = db.addPlan('trial', ['core'], { monthlyTokens: 200_000 });
  const tenant = db.addTenant(plan.id);
  // 本月用量從 150,000 一次累加到 200,000：同時跨越 80% 與 100%，兩個門檻都已告警
  const first = await checkQuotaThresholdCrossing(db.prisma, tenant.id, 50_000, 200_000);
  assert.deepEqual(first.map((c) => c.level), ['warning', 'critical']);
  db.setUsage(tenant.id, 200_000);
  const req = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 300_000 });

  await approveRequest(db.prisma, req.id, REVIEWER);

  // 新上限 500,000：用量從 390,000 累加到 400,000，跨越 80%
  const crossed = await checkQuotaThresholdCrossing(db.prisma, tenant.id, 10_000, 400_000);
  assert.deepEqual(crossed.map((c) => [c.level, c.limitTokens]), [['warning', 500_000]]);
});

// ── 駁回申請 ──

test('駁回不改變租戶：申請改成 rejected 並記錄審核者、時間與備註，方案與覆寫值不變', async () => {
  const db = createDb();
  const light = db.addPlan('light', ['core'], { monthlyTokens: 1_000_000 });
  db.addPlan('standard');
  const tenant = db.addTenant(light.id, { monthlyTokens: 1_200_000 });
  const upgrade = db.addRequest(tenant.id, { type: 'upgrade', targetPlanSlug: 'standard' });

  const result = await rejectRequest(db.prisma, upgrade.id, REVIEWER, '尚未收款');

  assert.equal(result.status, 'rejected');
  assert.equal(result.reviewedBy, REVIEWER);
  assert.equal(result.reviewNote, '尚未收款');
  assert.ok(result.reviewedAt instanceof Date);
  assert.equal(db.tenant(tenant.id).planId, light.id);
  assert.deepEqual(db.tenant(tenant.id).limitOverrides, { monthlyTokens: 1_200_000 });
});

// ── 只處理待審的申請 ──

test('已處理的申請不能再核准：回 400，申請與租戶都不變', async () => {
  const db = createDb();
  const light = db.addPlan('light', ['core'], { monthlyTokens: 1_000_000 });
  db.addPlan('standard');
  const tenant = db.addTenant(light.id);
  const reviewedAt = new Date('2026-09-01T00:00:00Z');
  const upgrade = db.addRequest(tenant.id, { type: 'upgrade', targetPlanSlug: 'standard', status: 'rejected', reviewedAt });
  const topup = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 500_000, status: 'approved', reviewedAt });

  await rejectsWith(approveRequest(db.prisma, upgrade.id, REVIEWER), 400);
  await rejectsWith(approveRequest(db.prisma, topup.id, REVIEWER), 400);

  assert.equal(db.tenant(tenant.id).planId, light.id);
  assert.deepEqual(db.tenant(tenant.id).limitOverrides, {});
  assert.deepEqual(db.requests.map((r) => [r.status, r.reviewedAt]), [['rejected', reviewedAt], ['approved', reviewedAt]]);
});

test('已處理的申請不能駁回：回 400，申請維持原本的狀態', async () => {
  const db = createDb();
  const tenant = db.addTenant(null);
  const req = db.addRequest(tenant.id, { type: 'token_topup', topupTokens: 1000, status: 'approved', reviewNote: '已收款' });

  await rejectsWith(rejectRequest(db.prisma, req.id, REVIEWER, '改駁回'), 400);
  assert.equal(db.requests[0]!.status, 'approved');
  assert.equal(db.requests[0]!.reviewNote, '已收款');
});

test('申請不存在：核准與駁回都回 404', async () => {
  const db = createDb();
  await rejectsWith(approveRequest(db.prisma, uuid(), REVIEWER), 404);
  await rejectsWith(rejectRequest(db.prisma, uuid(), REVIEWER), 404);
});
