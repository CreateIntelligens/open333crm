/**
 * 建立渠道時指定可見成員（change channel-visibility-fail-closed）。
 * 渠道可見範圍改成 fail-closed 後，沒有綁定的渠道誰都看不到；建立時不寫入綁定，
 * 新渠道就只有總店看得到。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'unit-test-credential-encryption-key!!!!';

const { createChannel } = await import('#src/modules/channel/channel.service.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222222';
const A2 = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

/** 模擬租戶內兩位啟用中的成員；記錄建立的渠道與綁定 */
function mockPrisma() {
  const state = { channels: [] as Array<Record<string, unknown>>, bindings: [] as Array<Record<string, unknown>> };
  const activeAgents = [A1, A2];
  const prisma = {
    tenant: { findUnique: async () => ({ limitOverrides: null, plan: null }) },
    channel: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'ch-1', ...data };
        state.channels.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }),
    },
    agent: {
      findMany: async ({ where }: { where: { tenantId: string; isActive: boolean; id?: { in: string[] } } }) => {
        assert.equal(where.tenantId, TENANT, '查成員要帶 tenantId');
        assert.equal(where.isActive, true, '只看啟用中的成員');
        const ids = where.id?.in ?? activeAgents;
        return ids.filter((id) => activeAgents.includes(id)).map((id) => ({ id }));
      },
    },
    agentChannelAccess: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.bindings.push(...data);
        return { count: data.length };
      },
    },
  };
  return { prisma, state };
}

const base = { channelType: 'WEBCHAT', displayName: '官網客服', credentials: {} };

test('Channel created for chosen members：只綁指定的成員', async () => {
  const { prisma, state } = mockPrisma();
  await createChannel(prisma as never, TENANT, { ...base, visibleAgentIds: [A1] });
  assert.deepEqual(
    state.bindings.map((b) => [b.channelId, b.agentId, b.accessLevel]),
    [['ch-1', A1, 'full']],
  );
});

test('Channel created without choosing members：綁所有啟用中的成員', async () => {
  const { prisma, state } = mockPrisma();
  await createChannel(prisma as never, TENANT, base);
  assert.deepEqual(state.bindings.map((b) => b.agentId).sort(), [A1, A2].sort());
});

test('visibleAgentIds 為空陣列：不綁任何成員（只有總店看得到）', async () => {
  const { prisma, state } = mockPrisma();
  await createChannel(prisma as never, TENANT, { ...base, visibleAgentIds: [] });
  assert.equal(state.channels.length, 1);
  assert.deepEqual(state.bindings, []);
});

/* code review：建立渠道後寫入綁定失敗時，不能留下只有總店看得到的渠道（Meta 串接不在交易內） */
test('寫入綁定失敗：刪掉剛建立的渠道並拋出錯誤', async () => {
  const { prisma, state } = mockPrisma();
  const deleted: string[] = [];
  Object.assign(prisma.agentChannelAccess, {
    createMany: async () => {
      throw new Error('FK violation');
    },
  });
  Object.assign(prisma.channel, {
    deleteMany: async ({ where }: { where: { id: string; tenantId: string } }) => {
      assert.equal(where.tenantId, TENANT);
      deleted.push(where.id);
      return { count: 1 };
    },
  });
  await assert.rejects(createChannel(prisma as never, TENANT, base), /FK violation/);
  assert.equal(state.channels.length, 1);
  assert.deepEqual(deleted, ['ch-1']);
});

test('Unknown member rejected：不是本租戶啟用中的成員 → 400，不建立渠道', async () => {
  const { prisma, state } = mockPrisma();
  await assert.rejects(
    createChannel(prisma as never, TENANT, { ...base, visibleAgentIds: [A1, OTHER] }),
    (err: { statusCode?: number }) => err.statusCode === 400,
  );
  assert.equal(state.channels.length, 0, '驗證失敗時不建立渠道');
  assert.equal(state.bindings.length, 0);
});

// ── 路由層：visibleAgentIds 要通過 createChannelSchema，並和建立渠道在同一個交易 ──

let app: FastifyInstance;
const routeState = mockPrisma();
let transactions = 0;
/** 建立者是否為總店；不是時，建立者自己要被加進可見成員 */
let creatorSeesAll = true;

beforeAll(async () => {
  const visibility = await import('#src/services/channel-visibility.js');
  vi.doMock('#src/services/channel-visibility.js', async () => ({
    ...visibility,
    resolveChannelVisibility: async () => (creatorSeesAll ? visibility.ALL_CHANNELS : new Set<string>()),
  }));
  vi.resetModules();
  const { default: channelRoutes } = await import('#src/modules/channel/channel.routes.js');
  const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
  app = Fastify();
  const tx = {
    ...routeState.prisma,
    $executeRaw: async () => 1,
    tenantAuditLog: { create: async () => ({}) },
  };
  // withTenant(fastify.prisma, …) 以 $transaction 包住建立與綁定
  app.decorate('prisma', {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      transactions += 1;
      return fn(tx);
    },
  } as never);
  app.decorate('authenticate', async (request: never) => {
    const req = request as { agent?: unknown; tenantPrisma?: unknown };
    req.agent = { id: A1, tenantId: TENANT, isCliSession: true };
    req.tenantPrisma = tx;
  });
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.ready();
});

beforeEach(() => {
  routeState.state.channels.length = 0;
  routeState.state.bindings.length = 0;
  transactions = 0;
  creatorSeesAll = true;
});

afterAll(async () => {
  await app.close();
});

test('POST /channels：visibleAgentIds 通過 schema，建立與綁定在同一個交易', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/channels',
    payload: { ...base, visibleAgentIds: [A2] },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(transactions, 1, '建立渠道與寫入綁定要在同一個交易');
  assert.deepEqual(routeState.state.bindings.map((b) => b.agentId), [A2]);
});

/* code review：沒有 view_all 的建立者把自己取消勾選，建完自己就看不到、也管理不了這個渠道 */
test('Creator without head-office access stays visible：自動把建立者加進可見成員', async () => {
  creatorSeesAll = false;
  const res = await app.inject({ method: 'POST', url: '/api/v1/channels', payload: { ...base, visibleAgentIds: [A2] } });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(routeState.state.bindings.map((b) => b.agentId).sort(), [A1, A2].sort());
});

test('POST /channels：visibleAgentIds 不是 UUID → 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/channels', payload: { ...base, visibleAgentIds: ['x'] } });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(routeState.state.channels.length, 0);
});
