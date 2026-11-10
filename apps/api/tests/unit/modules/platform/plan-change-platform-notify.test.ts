/**
 * 新的方案異動申請寄信通知平台帳號（change add-plan-change-platform-notify，主規格 plan-change-request
 * 「新申請寄信通知平台帳號」「通知信寄送失敗不影響申請且留下稽核紀錄」）。
 *
 * 寄信一律以 vi.mock() 取代 sendEmail()，本機的 SMTP 設定是真的信箱，測試絕不真的寄出。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-plan-change-notify-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
process.env.WEB_BASE_URL = 'https://crm.example.com';

import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_input: { to: string; subject: string; html: string }) => {}),
}));
vi.mock('#src/modules/email/email.service.js', () => ({ sendEmail }));

import { loadEnvConfig } from '#src/config/env.js';

loadEnvConfig();

const PLAN_CHANGES_URL = 'https://crm.example.com/admin/plan-changes';

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

interface RequestRow {
  id: string;
  tenantId: string;
  type: string;
  targetPlanSlug: string | null;
  topupTokens: number | null;
  note: string | null;
  status: string;
}

/** 只實作送出申請與通知用到的 Prisma 方法 */
function createDb() {
  const plans = [{ id: uuid(), slug: 'standard', name: '標準版', isTrial: false }];
  const tenants = new Map<string, { id: string; name: string }>();
  const platformUsers: Array<{ id: string; email: string; name: string; isActive: boolean }> = [];
  const requests: RequestRow[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const prisma = {
    plan: {
      findUnique: async ({ where }: { where: { slug: string } }) => plans.find((p) => p.slug === where.slug) ?? null,
    },
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => tenants.get(where.id) ?? null,
    },
    platformSetting: {
      findUnique: async () => null,
    },
    platformUser: {
      findMany: async ({ where }: { where: { isActive?: boolean } }) =>
        platformUsers.filter((u) => where.isActive === undefined || u.isActive === where.isActive).map((u) => ({ ...u })),
    },
    planChangeRequest: {
      findFirst: async ({ where }: { where: { tenantId: string; status: string } }) =>
        requests.find((r) => r.tenantId === where.tenantId && r.status === where.status) ?? null,
      create: async ({ data }: { data: Partial<RequestRow> & { tenantId: string; type: string } }) => {
        const row: RequestRow = { id: uuid(), targetPlanSlug: null, topupTokens: null, note: null, status: 'pending', ...data };
        requests.push(row);
        return { ...row };
      },
    },
    platformAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };

  return {
    prisma: prisma as never,
    requests,
    audits,
    addTenant(name: string) {
      const tenant = { id: uuid(), name };
      tenants.set(tenant.id, tenant);
      return tenant;
    },
    addPlatformUser(email: string, isActive = true) {
      platformUsers.push({ id: uuid(), email, name: email.split('@')[0], isActive });
    },
  };
}

type Db = ReturnType<typeof createDb>;

/** 租戶側的路由：成員有 settings.manage，租戶沒有方案（不受天花板影響） */
async function tenantApp(db: Db, tenantId: string) {
  const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
  const { default: planChangeRoutes } = await import('#src/modules/platform/plan-change.routes.js');
  const roleId = uuid();
  const prisma = db.prisma as Record<string, unknown>;
  prisma.rolePermission = {
    findMany: async ({ where }: { where: { roleId: string } }) =>
      where.roleId === roleId ? [{ permissionCode: 'settings.manage' }] : [],
  };
  const app = Fastify();
  app.decorate('prismaAdmin', db.prisma);
  app.decorate('redis', { get: async () => null, set: async () => 'OK' } as never);
  app.decorateRequest('agent', null);
  app.decorate('authenticate', async (request: never) => {
    (request as { agent: unknown }).agent = { id: 'agent-1', tenantId, roleId, role: 'ADMIN' };
  });
  await app.register(errorHandlerPlugin);
  await app.register(planChangeRoutes, { prefix: '/api/v1/plan-change' });
  return app;
}

/** 等背景的通知跑完：通知的最後一步是寫稽核 */
async function waitForNotifyAudit(db: Db) {
  await vi.waitFor(() => {
    assert.ok(db.audits.some((a) => a.action === 'plan_change.notify_platform'), '應寫入 plan_change.notify_platform');
  });
  return db.audits.find((a) => a.action === 'plan_change.notify_platform')!;
}

const recipientsOf = () => sendEmail.mock.calls.map(([input]) => input.to).sort();

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockImplementation(async () => {});
});

// ── 新申請寄信通知平台帳號 ──

test('送出加購申請後寄信給啟用中的平台帳號', async () => {
  const db = createDb();
  const tenant = db.addTenant('好物商行');
  db.addPlatformUser('boss@example.com');
  db.addPlatformUser('ops@example.com');
  db.addPlatformUser('former@example.com', false);
  const app = await tenantApp(db, tenant.id);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'token_topup', topupTokens: 500000, note: 'AI 快用完了' },
  });
  assert.equal(res.statusCode, 200);
  await waitForNotifyAudit(db);
  await app.close();

  assert.deepEqual(recipientsOf(), ['boss@example.com', 'ops@example.com']);
  for (const [input] of sendEmail.mock.calls) {
    assert.ok(input.subject.includes('好物商行'), `主旨應含租戶名稱：${input.subject}`);
    for (const text of ['好物商行', '加購 Token', '500,000', 'AI 快用完了', PLAN_CHANGES_URL]) {
      assert.ok(input.html.includes(text), `信中應含「${text}」`);
    }
  }
});

test('升級申請的信寫出目標方案名稱', async () => {
  const db = createDb();
  const tenant = db.addTenant('好物商行');
  db.addPlatformUser('boss@example.com');
  const app = await tenantApp(db, tenant.id);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'upgrade', targetPlanSlug: 'standard' },
  });
  assert.equal(res.statusCode, 200);
  await waitForNotifyAudit(db);
  await app.close();

  assert.equal(sendEmail.mock.calls.length, 1);
  const [input] = sendEmail.mock.calls[0];
  for (const text of ['升級方案', '標準版', '未填寫']) {
    assert.ok(input.html.includes(text), `信中應含「${text}」`);
  }
});

test('申請被拒絕時不寄信', async () => {
  const db = createDb();
  const tenant = db.addTenant('好物商行');
  db.addPlatformUser('boss@example.com');
  db.requests.push({ id: uuid(), tenantId: tenant.id, type: 'token_topup', targetPlanSlug: null, topupTokens: 100000, note: null, status: 'pending' });
  const app = await tenantApp(db, tenant.id);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'token_topup', topupTokens: 200000 },
  });
  // 讓可能存在的背景工作有機會執行
  await new Promise((resolve) => setTimeout(resolve, 20));
  await app.close();

  assert.equal(res.statusCode, 409);
  assert.equal(sendEmail.mock.calls.length, 0);
  assert.equal(db.audits.length, 0);
});

// ── 通知信寄送失敗不影響申請且留下稽核紀錄 ──

test('一封信寄送失敗時申請仍成功', async () => {
  const db = createDb();
  const tenant = db.addTenant('好物商行');
  db.addPlatformUser('boss@example.com');
  db.addPlatformUser('ops@example.com');
  sendEmail.mockImplementation(async (input) => {
    if (input.to === 'ops@example.com') throw new Error('SMTP timeout');
  });
  const app = await tenantApp(db, tenant.id);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'token_topup', topupTokens: 500000 },
  });
  assert.equal(res.statusCode, 200);
  const audit = await waitForNotifyAudit(db);
  await app.close();

  assert.equal(db.requests.length, 1);
  assert.equal(db.requests[0].status, 'pending');
  assert.deepEqual(recipientsOf(), ['boss@example.com', 'ops@example.com']);
  assert.equal(audit.platformUserId, null);
  assert.equal(audit.targetType, 'plan_change_request');
  assert.equal(audit.targetId, db.requests[0].id);
  const payload = audit.payload as { recipients: number; sent: number; failed: Array<{ email: string; reason: string }> };
  assert.equal(payload.recipients, 2);
  assert.equal(payload.sent, 1);
  assert.deepEqual(payload.failed, [{ email: 'ops@example.com', reason: 'SMTP timeout' }]);
});

test('沒有啟用中的平台帳號', async () => {
  const db = createDb();
  const tenant = db.addTenant('好物商行');
  db.addPlatformUser('former@example.com', false);
  const app = await tenantApp(db, tenant.id);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'token_topup', topupTokens: 500000 },
  });
  assert.equal(res.statusCode, 200);
  const audit = await waitForNotifyAudit(db);
  await app.close();

  assert.equal(sendEmail.mock.calls.length, 0);
  const payload = audit.payload as { recipients: number; sent: number };
  assert.equal(payload.recipients, 0);
  assert.equal(payload.sent, 0);
});

test('查詢收件人失敗時申請仍成功，稽核記下原因', async () => {
  const db = createDb();
  const tenant = db.addTenant('好物商行');
  (db.prisma as { platformUser: { findMany: () => Promise<never> } }).platformUser.findMany = async () => {
    throw new Error('connection reset');
  };
  const app = await tenantApp(db, tenant.id);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/plan-change',
    payload: { type: 'token_topup', topupTokens: 500000 },
  });
  assert.equal(res.statusCode, 200);
  const audit = await waitForNotifyAudit(db);
  await app.close();

  assert.equal(sendEmail.mock.calls.length, 0);
  assert.equal((audit.payload as { error: string }).error, 'connection reset');
});
