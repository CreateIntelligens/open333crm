/**
 * 平台路由寫入的稽核內容（主規格 platform-auth「平台操作稽核」、tenant-plan「平台變更租戶的方案」）。
 * 服務層換成 mock，只檢查路由交給 writePlatformAudit 的內容。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';

const audits = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('#src/modules/platform/platform-audit.service.js', () => ({
  writePlatformAudit: async (_prisma: unknown, input: Record<string, unknown>) => {
    audits.push(input);
  },
}));
vi.mock('#src/modules/platform/plan.service.js', () => ({
  listPlans: async () => [],
  updatePlan: async (_prisma: unknown, id: string) => ({ id }),
}));
vi.mock('#src/modules/platform/platform-setting.service.js', () => ({
  getPlatformSetting: async () => null,
  setPlatformSetting: async () => undefined,
}));
vi.mock('#src/modules/platform/platform-tenant.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/platform/platform-tenant.service.js')>()),
  provisionTenantViaApi: async () => ({ tenantId: TENANT_ID }),
  updateTenant: async (_prisma: unknown, id: string) => ({ id }),
}));

import platformRoutes from '#src/modules/platform/platform.routes.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const PLATFORM_USER_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  audits.length = 0;
});

async function request(method: 'POST' | 'PATCH' | 'PUT', url: string, payload: unknown) {
  const app = Fastify();
  app.decorate('prismaAdmin', {} as never);
  app.decorateRequest('platformUser', null);
  app.decorate('authenticatePlatformSuperuser', async (req: { platformUser: unknown }) => {
    req.platformUser = { id: PLATFORM_USER_ID, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
  });
  await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  const res = await app.inject({ method, url: `/api/v1/platform${url}`, payload });
  await app.close();
  return res;
}

test('改 plan 留稽核：寫入 plan.update，目標是被更新的方案', async () => {
  const res = await request('PATCH', `/plans/${PLAN_ID}`, { limits: { maxAgents: 5 } });

  assert.equal(res.statusCode, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'plan.update');
  assert.equal(audits[0]!.targetType, 'plan');
  assert.equal(audits[0]!.targetId, PLAN_ID);
  assert.equal(audits[0]!.platformUserId, PLATFORM_USER_ID);
});

test('開通租戶的稽核不含管理員密碼：payload 只含方案的 slug 與租戶名稱', async () => {
  const password = 'Admin-Secret-Password-9';
  const res = await request('POST', '/tenants', {
    name: 'Acme',
    planSlug: 'standard',
    adminEmail: 'admin@acme.example',
    adminName: 'Admin',
    adminPassword: password,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'tenant.provision');
  assert.deepEqual(audits[0]!.payload, { planSlug: 'standard', name: 'Acme' });
  assert.equal(JSON.stringify(audits[0]).includes(password), false);
});

test('更新平台設定的稽核不含設定值：寫入 setting.update，targetId 是設定 key', async () => {
  const secret = 'smtp-password-xyz';
  const res = await request('PUT', '/settings/smtp', { value: { host: 'smtp.example', password: secret } });

  assert.equal(res.statusCode, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'setting.update');
  assert.equal(audits[0]!.targetId, 'smtp');
  assert.equal(JSON.stringify(audits[0]).includes(secret), false);
});

test('變更方案留稽核：寫入 tenant.update，payload 的 planSlug 是新方案', async () => {
  const res = await request('PATCH', `/tenants/${TENANT_ID}`, { planSlug: 'standard' });

  assert.equal(res.statusCode, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'tenant.update');
  assert.equal(audits[0]!.targetId, TENANT_ID);
  assert.equal((audits[0]!.payload as { planSlug: string }).planSlug, 'standard');
});
