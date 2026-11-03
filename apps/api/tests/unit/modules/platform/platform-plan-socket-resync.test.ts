/**
 * 方案異動後重新計算已連線 socket 的渠道房間（PR #438 審查；主規格 socket-room-authorization
 * 「授權變更時重新計算房間」）：方案拿掉 channel.view_all 時，已連線的成員要離開總店房間，不必重新連線。
 * 服務層換成 mock，只檢查路由在寫入成功後對哪些租戶呼叫 syncSocketChannelRooms。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '66666666-6666-4666-8666-666666666666';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const PLATFORM_USER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

const state = vi.hoisted(() => ({ requestType: 'upgrade' as string }));

vi.mock('#src/modules/platform/platform-audit.service.js', () => ({ writePlatformAudit: async () => undefined }));
vi.mock('#src/modules/platform/plan.service.js', () => ({
  listPlans: async () => [],
  updatePlan: async (_prisma: unknown, id: string) => ({ id }),
  listTenantIdsOnPlan: async () => [TENANT_ID, OTHER_TENANT_ID],
}));
vi.mock('#src/modules/platform/platform-tenant.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/platform/platform-tenant.service.js')>()),
  updateTenant: async (_prisma: unknown, id: string) => ({ id }),
}));
vi.mock('#src/modules/platform/trial-admin.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/platform/trial-admin.service.js')>()),
  convertToPaid: async (_prisma: unknown, id: string) => ({ id }),
}));
vi.mock('#src/modules/platform/plan-change.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/platform/plan-change.service.js')>()),
  approveRequest: async (_prisma: unknown, id: string) => ({ id, tenantId: TENANT_ID, type: state.requestType, trialExited: false }),
}));

import platformRoutes from '#src/modules/platform/platform.routes.js';

const synced: Array<string> = [];

beforeEach(() => {
  synced.length = 0;
  state.requestType = 'upgrade';
});

async function request(url: string, payload: unknown) {
  const app = Fastify();
  app.decorate('prismaAdmin', {} as never);
  app.decorate('syncSocketChannelRooms', async (tenantId: string, agentId?: string) => {
    synced.push(`${tenantId}:${agentId ?? '*'}`);
  });
  app.decorateRequest('platformUser', null);
  app.decorate('authenticatePlatformSuperuser', async (req: { platformUser: unknown }) => {
    req.platformUser = { id: PLATFORM_USER_ID, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
  });
  await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  const res = await app.inject({ method: 'PATCH', url: `/api/v1/platform${url}`, payload });
  await app.close();
  return res;
}

test('平台改租戶的方案：重新計算該租戶的連線', async () => {
  const res = await request(`/tenants/${TENANT_ID}`, { planSlug: 'basic' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, [`${TENANT_ID}:*`]);
});

test('平台只改租戶名稱：不重新計算', async () => {
  const res = await request(`/tenants/${TENANT_ID}`, { name: '新名稱' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, []);
});

test('核准升級申請：重新計算該租戶的連線', async () => {
  const res = await request(`/plan-change-requests/${REQUEST_ID}/approve`, {});
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, [`${TENANT_ID}:*`]);
});

test('核准加購 token：方案不變，不重新計算', async () => {
  state.requestType = 'token_topup';
  const res = await request(`/plan-change-requests/${REQUEST_ID}/approve`, {});
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, []);
});

test('試用轉正式方案：重新計算該租戶的連線', async () => {
  const res = await request(`/trial-tenants/${TENANT_ID}/convert`, { planSlug: 'standard' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, [`${TENANT_ID}:*`]);
});

test('方案的功能或權限設定改變：重新計算使用這個方案的每個租戶', async () => {
  const res = await request(`/plans/${PLAN_ID}`, { permissionOverrides: { deny: ['channel.view_all'] } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, [`${TENANT_ID}:*`, `${OTHER_TENANT_ID}:*`]);
});

test('方案只改上限：權限不變，不重新計算', async () => {
  const res = await request(`/plans/${PLAN_ID}`, { limits: { maxAgents: 5 } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(synced, []);
});
