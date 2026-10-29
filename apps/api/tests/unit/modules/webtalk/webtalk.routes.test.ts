/**
 * WebTalk 路由（change webtalk-multi-tenant，spec webtalk-collaboration）。
 * 認證以注入的成員取代；權限由真實的 requirePermission 計算，只把「讀角色權限」換成假資料。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

const { rolePermissions } = vi.hoisted(() => ({ rolePermissions: new Map<string, Set<string>>() }));
vi.mock('#src/services/permission.service.js', () => ({
  getEffectiveTenantPermissions: async (_db: unknown, roleId: string) => rolePermissions.get(roleId) ?? new Set(),
}));
vi.mock('#src/services/tenant-plan.cache.js', () => ({ getTenantPlanId: async () => null }));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import webtalkRoutes from '#src/modules/webtalk/webtalk.routes.js';
import { deriveWebTalkRoomId, type WebTalkServerConfig } from '#src/modules/webtalk/webtalk.service.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = 'b0000000-0000-0000-0000-000000000002';
const SECRET = 'r'.repeat(40);

let serverConfig: WebTalkServerConfig | null;
/** 各租戶的 tenant_settings 列（模擬 RLS：每個請求只看得到自己租戶的列） */
const rows = new Map<string, { webtalkEnabled: boolean; webtalkAiEnabled: boolean; webtalkRoomVersion: number }>();
const audits: Array<Record<string, unknown>> = [];

function tenantDb(tenantId: string) {
  const get = () => rows.get(tenantId) ?? { webtalkEnabled: true, webtalkAiEnabled: false, webtalkRoomVersion: 0 };
  return {
    tenantSettings: {
      findUnique: async (args: any) => {
        assert.equal(args.where.tenantId, tenantId, '只查自己租戶');
        return rows.get(tenantId) ?? null;
      },
      upsert: async (args: any) => {
        assert.equal(args.where.tenantId, tenantId, '只寫自己租戶');
        const next = { ...get() };
        for (const [k, v] of Object.entries(rows.has(tenantId) ? args.update : { ...args.update, ...args.create })) {
          if (k === 'tenantId') continue;
          (next as any)[k] = typeof v === 'object' && v && 'increment' in (v as object)
            ? (next as any)[k] + (v as { increment: number }).increment
            : v;
        }
        rows.set(tenantId, next);
        return next;
      },
    },
    tenantAuditLog: { create: async (args: any) => { audits.push(args.data); return args.data; } },
  };
}

/**
 * 假的 fastify.prisma：inTenant() 開交易時以 set_config 設定租戶，之後的查詢落在該租戶的 tenantDb。
 * route 不再收 request.tenantPrisma，所以 authenticate 不注入它。
 */
const prisma = {
  async $transaction(cb: (tx: unknown) => Promise<unknown>) {
    let tenantId = '';
    const tx = {
      $executeRaw: async (_sql: TemplateStringsArray, id: string) => {
        tenantId = id;
        return 1;
      },
      get tenantSettings() { return tenantDb(tenantId).tenantSettings; },
      get tenantAuditLog() { return tenantDb(tenantId).tenantAuditLog; },
    };
    return cb(tx);
  },
};

/** 以 header 指定登入身分；沒有 header 視為未登入 */
async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.headers['x-test-agent'];
  if (typeof raw !== 'string') {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '請先登入' } });
  }
  const agent = JSON.parse(raw);
  (request as any).agent = agent;
}

let app: FastifyInstance;

beforeAll(async () => {
  rolePermissions.set('role-admin', new Set(['settings.manage']));
  rolePermissions.set('role-agent', new Set(['inbox.view']));
  app = Fastify();
  app.decorate('authenticate', authenticate);
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', {} as never);
  app.decorateRequest('agent', null);
  await app.register(errorHandlerPlugin);
  await app.register(webtalkRoutes, { prefix: '/api/v1/webtalk', resolveConfig: () => serverConfig });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  rows.clear();
  audits.length = 0;
  serverConfig = {
    roomSecret: SECRET,
    siteId: 'open333crm-test',
    sdkUrl: 'https://sdk.example.test/webtalk.js',
    sdkIntegrity: null,
    aiEndpoint: null,
  };
});

const as = (tenantId: string, roleId = 'role-agent', extra: object = {}) => ({
  'x-test-agent': JSON.stringify({ id: `agent-${tenantId.slice(0, 1)}-${roleId}`, tenantId, roleId, role: 'AGENT', ...extra }),
});
const session = (headers?: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/api/v1/webtalk/session', headers });

// ── session ──

test('Unauthenticated request is rejected', async () => {
  const res = await session();
  assert.equal(res.statusCode, 401);
  assert.ok(!res.body.includes('roomId'));
});

test('Non-human credentials are rejected', async () => {
  for (const extra of [{ isPartnerKey: true }, { isCliSession: true }]) {
    const res = await session(as(TENANT_A, 'role-admin', extra));
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.code, 'FORBIDDEN');
    assert.ok(!res.body.includes('roomId'));
  }
});

test('Missing room secret fails closed', async () => {
  serverConfig = null;
  const res = await session(as(TENANT_A));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { enabled: false, reason: 'NOT_CONFIGURED' });
});

test('Agents of the same tenant share one room / Different tenants never share a room', async () => {
  const a1 = (await session(as(TENANT_A, 'role-agent'))).json().data;
  const a2 = (await session(as(TENANT_A, 'role-admin'))).json().data;
  const b = (await session(as(TENANT_B, 'role-agent'))).json().data;
  assert.equal(a1.enabled, true);
  assert.equal(a1.roomId, a2.roomId);
  assert.notEqual(a1.roomId, b.roomId);
  assert.equal(a1.roomId, deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0), '租戶取自登入身分');
  assert.equal(a1.sdkUrl, 'https://sdk.example.test/webtalk.js');
  assert.equal(a1.aiEnabled, false);
  assert.equal(a1.aiEndpoint, null);
});

test('session 不接受以 query 指定租戶', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/webtalk/session?tenantId=${TENANT_B}`, headers: as(TENANT_A) });
  assert.equal(res.json().data.roomId, deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0));
});

// ── 設定 ──

test('Defaults without a settings row', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/webtalk/settings', headers: as(TENANT_A, 'role-admin') });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { enabled: true, aiEnabled: false });
});

test('Tenant disables WebTalk', async () => {
  const before = (await session(as(TENANT_B))).json().data;
  const res = await app.inject({
    method: 'PUT', url: '/api/v1/webtalk/settings', headers: as(TENANT_A, 'role-admin'), payload: { enabled: false },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { enabled: false, aiEnabled: false });
  assert.deepEqual((await session(as(TENANT_A))).json().data, { enabled: false, reason: 'TENANT_DISABLED' });
  assert.deepEqual((await session(as(TENANT_B))).json().data, before, '其他租戶不受影響');
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.action, 'settings.update');
  assert.deepEqual(audits[0]!.payload, { section: 'webtalk', enabled: false, aiEnabled: false });
});

test('AI summary enabled by the tenant（路由層）', async () => {
  serverConfig = { ...serverConfig!, aiEndpoint: 'https://ai.example.test/api/webtalk/ai' };
  await app.inject({ method: 'PUT', url: '/api/v1/webtalk/settings', headers: as(TENANT_A, 'role-admin'), payload: { aiEnabled: true } });
  const data = (await session(as(TENANT_A))).json().data;
  assert.equal(data.aiEnabled, true);
  assert.equal(data.aiEndpoint, 'https://ai.example.test/api/webtalk/ai');
});

test('Settings change requires permission', async () => {
  for (const [method, url, payload] of [
    ['GET', '/api/v1/webtalk/settings', undefined],
    ['PUT', '/api/v1/webtalk/settings', { enabled: false }],
    ['POST', '/api/v1/webtalk/settings/rotate-room', undefined],
  ] as const) {
    const res = await app.inject({ method, url, headers: as(TENANT_A, 'role-agent'), payload });
    assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
    assert.equal(res.json().error.details.requiredPermission, 'settings.manage');
  }
  assert.equal(rows.size, 0, '設定不變');
});

test('Invalid settings body is rejected', async () => {
  for (const payload of [{ enabled: 'yes' }, {}, { enabled: true, extra: 1 }]) {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/webtalk/settings', headers: as(TENANT_A, 'role-admin'), payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(rows.size, 0, '設定不變');
});

test('Rotation changes the room ID', async () => {
  const beforeA = (await session(as(TENANT_A))).json().data.roomId;
  const beforeB = (await session(as(TENANT_B))).json().data.roomId;
  const res = await app.inject({ method: 'POST', url: '/api/v1/webtalk/settings/rotate-room', headers: as(TENANT_A, 'role-admin') });
  assert.equal(res.statusCode, 200, res.body);
  const afterA = (await session(as(TENANT_A))).json().data.roomId;
  assert.notEqual(afterA, beforeA);
  assert.equal((await session(as(TENANT_B))).json().data.roomId, beforeB, '其他租戶不變');
  assert.equal(audits.at(-1)!.action, 'settings.update');
  assert.deepEqual(audits.at(-1)!.payload, { section: 'webtalk', rotateRoom: true });
});

// ── AI 停用端點 ──

test('Disabled AI endpoint refuses requests', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/webtalk/ai-disabled',
    payload: { model: 'default', messages: [{ role: 'user', content: '王小明 0912-345-678' }] },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'WEBTALK_AI_DISABLED');
  assert.match(res.json().error.message, /停用/);
  assert.ok(!res.body.includes('王小明'), '不回顯內容');
});
