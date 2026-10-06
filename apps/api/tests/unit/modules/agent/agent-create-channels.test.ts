/**
 * 建立成員時指定可見渠道（change channel-visibility-fail-closed）。
 * 渠道可見範圍改成 fail-closed 後，沒有任何綁定的成員（非總店）什麼都看不到；
 * 建立時不寫入綁定，新成員登入後收件匣是空的。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

const { createAgent } = await import('#src/modules/agent/agent.service.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CREATOR = '22222222-2222-4222-8222-222222222222';
const CH1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CH2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CH_HIDDEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** 租戶有三個渠道；指派者是 admin system role（越權檢查直接放行） */
function mockPrisma() {
  const state = { agents: [] as Array<Record<string, unknown>>, bindings: [] as Array<Record<string, unknown>> };
  const tenantChannels = [CH1, CH2, CH_HIDDEN];
  const prisma = {
    agent: {
      findUnique: async () => null,
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'new-agent', ...data };
        state.agents.push(row);
        return row;
      },
    },
    tenant: { findUnique: async () => ({ limitOverrides: null, plan: null }) },
    role: { findFirst: async () => ({ id: 'role-1', slug: 'admin', isSystem: true }) },
    channel: {
      findMany: async ({ where }: { where: { tenantId: string; id?: { in: string[] } } }) => {
        assert.equal(where.tenantId, TENANT, '查渠道要帶 tenantId');
        const ids = where.id?.in ?? tenantChannels;
        return ids.filter((id) => tenantChannels.includes(id)).map((id) => ({ id }));
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

const input = (extra: Record<string, unknown> = {}) => ({
  name: '分店店員',
  email: 'branch@example.test',
  role: 'AGENT' as const,
  password: 'password123',
  ...extra,
});

test('Member created with chosen channels：只綁指定的渠道', async () => {
  const { prisma, state } = mockPrisma();
  await createAgent(prisma as never, TENANT, input({ channelIds: [CH1] }), 'role-1', {
    grantable: ALL_CHANNELS,
    grantedById: CREATOR,
  });
  assert.deepEqual(
    state.bindings.map((b) => [b.agentId, b.channelId, b.accessLevel, b.grantedById]),
    [['new-agent', CH1, 'full', CREATOR]],
  );
});

test('Member created without choosing channels：總店建立時綁租戶所有渠道', async () => {
  const { prisma, state } = mockPrisma();
  await createAgent(prisma as never, TENANT, input(), 'role-1', { grantable: ALL_CHANNELS, grantedById: CREATOR });
  assert.deepEqual(state.bindings.map((b) => b.channelId).sort(), [CH1, CH2, CH_HIDDEN].sort());
});

test('沒指定渠道、建立者只看得到部分渠道：綁建立者看得到的渠道', async () => {
  const { prisma, state } = mockPrisma();
  await createAgent(prisma as never, TENANT, input(), 'role-1', {
    grantable: new Map([[CH1, 'full'], [CH2, 'full']]),
    grantedById: CREATOR,
  });
  assert.deepEqual(state.bindings.map((b) => b.channelId).sort(), [CH1, CH2].sort());
});

test('Creator cannot grant a channel they cannot see：403，不建立成員', async () => {
  const { prisma, state } = mockPrisma();
  await assert.rejects(
    createAgent(prisma as never, TENANT, input({ channelIds: [CH1, CH_HIDDEN] }), 'role-1', {
      grantable: new Map([[CH1, 'full'], [CH2, 'full']]),
      grantedById: CREATOR,
    }),
    (err: { statusCode?: number }) => err.statusCode === 403,
  );
  assert.equal(state.agents.length, 0, '不建立成員');
  assert.equal(state.bindings.length, 0);
});

test('指定不屬於本租戶的渠道：400，不建立成員', async () => {
  const { prisma, state } = mockPrisma();
  await assert.rejects(
    createAgent(prisma as never, TENANT, input({ channelIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] }), 'role-1', {
      grantable: ALL_CHANNELS,
      grantedById: CREATOR,
    }),
    (err: { statusCode?: number }) => err.statusCode === 400,
  );
  assert.equal(state.agents.length, 0);
});

/* code review：建立者對某渠道只有 read_only 時，新成員原本一律拿到 full，等於藉由建立成員越權 */
test("New member's level capped at the creator's level：新成員的層級不高於建立者", async () => {
  const { prisma, state } = mockPrisma();
  await createAgent(prisma as never, TENANT, input({ channelIds: [CH1, CH2] }), 'role-1', {
    grantable: new Map([[CH1, 'read_only'], [CH2, 'reply_only']]),
    grantedById: CREATOR,
  });
  assert.deepEqual(
    state.bindings.map((b) => [b.channelId, b.accessLevel]).sort(),
    [[CH1, 'read_only'], [CH2, 'reply_only']].sort(),
  );
});

// ── 路由層：channelIds 要通過 createAgentSchema，並和建立成員在同一個交易 ──

const createAgentSpy = vi.fn();
let app: FastifyInstance;
let transactions = 0;

beforeAll(async () => {
  vi.doMock('#src/modules/agent/agent.service.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#src/modules/agent/agent.service.js')>()),
    createAgent: async (...args: unknown[]) => {
      createAgentSpy(...args);
      return { id: 'new-agent', role: 'AGENT' };
    },
  }));
  vi.doMock('#src/services/channel-visibility.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#src/services/channel-visibility.js')>()),
    resolveChannelGrantScope: async () => ALL_CHANNELS,
  }));
  vi.resetModules();
  const { default: agentRoutes } = await import('#src/modules/agent/agent.routes.js');
  const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
  app = Fastify();
  const tx = { $executeRaw: async () => 1 };
  app.decorate('prisma', {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      transactions += 1;
      return fn(tx);
    },
  } as never);
  app.decorate('authenticate', async (request: never) => {
    const req = request as { agent?: unknown; tenantPrisma?: unknown };
    req.agent = { id: CREATOR, tenantId: TENANT, roleId: 'role-1', isCliSession: true };
    req.tenantPrisma = { tenantAuditLog: { create: async () => ({}) } };
  });
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(errorHandlerPlugin);
  await app.register(agentRoutes, { prefix: '/api/v1/agents' });
  await app.ready();
});

beforeEach(() => {
  createAgentSpy.mockClear();
  transactions = 0;
});

afterAll(async () => {
  await app?.close();
  vi.doUnmock('#src/modules/agent/agent.service.js');
  vi.doUnmock('#src/services/channel-visibility.js');
});

test('POST /agents：channelIds 通過 schema，建立成員在交易內並帶入可指派範圍', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/agents', payload: input({ channelIds: [CH2] }) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(transactions, 1, '建立成員與寫入綁定要在同一個交易');
  const [, tenantId, body, , grant] = createAgentSpy.mock.calls[0]!;
  assert.equal(tenantId, TENANT);
  assert.deepEqual((body as { channelIds?: string[] }).channelIds, [CH2]);
  const g = grant as { grantable: unknown; grantedById: string; passwordHash?: string };
  assert.equal(g.grantable, ALL_CHANNELS);
  assert.equal(g.grantedById, CREATOR);
  assert.ok(g.passwordHash && g.passwordHash !== 'password123', '密碼在交易外先雜湊好，不傳明文進交易');
});

test('POST /agents：channelIds 不是 UUID → 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/agents', payload: input({ channelIds: ['x'] }) });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(createAgentSpy.mock.calls.length, 0);
});
