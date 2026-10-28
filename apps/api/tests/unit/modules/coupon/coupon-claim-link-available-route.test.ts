/**
 * GET /api/v1/coupons/claim-links 需 coupon.view 或 marketing.manage 任一（change improve-coupon-url-insert-ux，
 * spec coupon-management「列出租戶全部可用的領券連結」）。
 * 權限由真實的 requirePermission 計算，只把「讀角色權限」換成假資料；flow 換成假資料。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, test, vi } from 'vitest';

const { rolePermissions, flowCalls } = vi.hoisted(() => ({
  rolePermissions: new Map<string, Set<string>>(),
  flowCalls: [] as Array<{ tenantId: string; webBaseUrl: string; filter: unknown }>,
}));
vi.mock('#src/services/permission.service.js', () => ({
  getEffectiveTenantPermissions: async (_db: unknown, roleId: string) => rolePermissions.get(roleId) ?? new Set(),
}));
vi.mock('#src/services/tenant-plan.cache.js', () => ({ getTenantPlanId: async () => null }));
vi.mock('#src/config/env.js', () => ({ getConfig: () => ({ WEB_BASE_URL: 'https://crm.example.com' }) }));
vi.mock('#src/modules/coupon/coupon-claim-link.flow.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listAvailableClaimLinksFlow: async (_deps: unknown, tenantId: string, webBaseUrl: string, filter: unknown) => {
    flowCalls.push({ tenantId, webBaseUrl, filter });
    return [{ id: 'l1', name: '門市海報', couponName: '秋季九折', url: `${webBaseUrl}/coupon/claim/AB12CD34` }];
  },
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import couponClaimLinkRoutes from '#src/modules/coupon/coupon-claim-link.routes.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
let app: FastifyInstance;

async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  const roleId = String(request.headers['x-test-role'] ?? 'role-none');
  (request as any).agent = { id: 'agent-1', tenantId: TENANT, roleId, role: 'AGENT' };
  (request as any).tenantPrisma = {};
}

beforeAll(async () => {
  rolePermissions.set('role-viewer', new Set(['coupon.view']));
  rolePermissions.set('role-marketing', new Set(['marketing.manage']));
  rolePermissions.set('role-none', new Set(['marketing.view', 'inbox.view']));
  app = Fastify();
  app.decorate('authenticate', authenticate);
  app.decorate('prisma', {} as never);
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(couponClaimLinkRoutes, { prefix: '/api/v1/coupons' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('缺少檢視權限：coupon.view 與 marketing.manage 都沒有時回 403', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/coupons/claim-links', headers: { 'x-test-role': 'role-none' } });
  assert.equal(res.statusCode, 403, res.body);
  assert.deepEqual(res.json().error.details?.requiredAnyOf, ['coupon.view', 'marketing.manage']);
});

test('只有 marketing.manage 的素材編輯者可以讀', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/coupons/claim-links', headers: { 'x-test-role': 'role-marketing' } });
  assert.equal(res.statusCode, 200, res.body);
});

test('依渠道篩選：channelType 傳給 flow；不支援的值回 400', async () => {
  flowCalls.length = 0;
  const ok = await app.inject({ method: 'GET', url: '/api/v1/coupons/claim-links?channelType=FB', headers: { 'x-test-role': 'role-viewer' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(flowCalls[0]!.filter, { channelType: 'FB' });
  const bad = await app.inject({ method: 'GET', url: '/api/v1/coupons/claim-links?channelType=WEBCHAT', headers: { 'x-test-role': 'role-viewer' } });
  assert.equal(bad.statusCode, 400, bad.body);
});

test('有 coupon.view：回 200 與清單，網址以 WEB_BASE_URL 組成', async () => {
  flowCalls.length = 0;
  const res = await app.inject({ method: 'GET', url: '/api/v1/coupons/claim-links', headers: { 'x-test-role': 'role-viewer' } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data[0].url, 'https://crm.example.com/coupon/claim/AB12CD34');
  assert.deepEqual(flowCalls, [{ tenantId: TENANT, webBaseUrl: 'https://crm.example.com', filter: {} }]);
});
