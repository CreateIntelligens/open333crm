import assert from 'node:assert/strict';
import Fastify from 'fastify';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-cli-session-jwt-secret';

import authPlugin from '../plugins/auth.plugin.js';
import errorHandlerPlugin from '../plugins/error-handler.plugin.js';
import authRoutes from '../modules/auth/auth.routes.js';
import cliRoutes from '../modules/cli/cli.routes.js';
import { loadEnvConfig } from '../config/env.js';
import {
  createCliSession,
  verifyCliSession,
} from '../modules/auth/cli-session.service.js';
import { hashPassword } from '../shared/utils/password.js';

type MockFn = ((...args: any[]) => any) & { calls: any[][] };

function mockFn(impl?: (...args: any[]) => any): MockFn {
  const fn = ((...args: any[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

function createAgent(passwordHash: string) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    email: 'agent@example.test',
    name: 'CLI Agent',
    role: 'ADMIN',
    avatarUrl: null,
    passwordHash,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    teams: [],
  };
}

function createPrismaMock(agent: ReturnType<typeof createAgent>) {
  const sessions: any[] = [];
  const queryRawCalls: any[][] = [];
  const prisma = {
    _sessions: sessions,
    _queryRawCalls: queryRawCalls,
    $queryRaw: mockFn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queryRawCalls.push([strings, ...values]);
      const sql = Array.from(strings).join('?');
      if (sql.includes('AVG(EXTRACT(EPOCH FROM')) {
        return [{ avg_first_response: 12.3, avg_resolution: 45.6 }];
      }
      if (sql.includes('AVG("csatScore")')) {
        return [{ avg_score: 4.2, total: 5n, positive: 4n }];
      }
      if (sql.includes('COUNT(*) FILTER (WHERE "resolvedAt" <= "slaDueAt")')) {
        return [{ total: 4n, achieved: 3n }];
      }
      if (sql.includes('COUNT(*) FILTER (WHERE m.direction')) {
        return [{ total: 10n, inbound: 6n, outbound: 4n }];
      }
      if (sql.includes('date_trunc') && sql.includes('FROM messages')) {
        return [{ date: new Date('2026-06-01T00:00:00.000Z'), channel_type: 'LINE', count: 10n }];
      }
      if (sql.includes('date_trunc') && sql.includes('FROM cases')) {
        return [{ date: new Date('2026-06-01T00:00:00.000Z'), opened: 3n, closed: 1n }];
      }
      if (sql.includes('COALESCE(category')) {
        return [{ category: '查詢', count: 2n }];
      }
      if (sql.includes('SELECT priority')) {
        return [{ priority: 'HIGH', count: 1n }];
      }
      if (sql.includes('SELECT status')) {
        return [{ status: 'OPEN', count: 2n }];
      }
      if (sql.includes('c."channelType" AS channel_type')) {
        return [{ channel_type: 'LINE', count: 10n }];
      }
      if (sql.includes('FROM conversations')) {
        return [{ channel_type: 'LINE', count: 4n }];
      }
      if (sql.includes('FROM channel_identities')) {
        return [{ channel_type: 'LINE', count: 2n }];
      }
      return [];
    }),
    agent: {
      findUnique: mockFn(async () => agent),
      findFirst: mockFn(async () => {
        const { passwordHash: _passwordHash, ...publicAgent } = agent;
        return publicAgent;
      }),
    },
    case: {
      count: mockFn(async ({ where }) => {
        if (where?.status === 'ESCALATED') return 1;
        if (where?.status?.in) return 2;
        if (where?.resolvedAt) return 1;
        if (where?.createdAt) return 3;
        return 0;
      }),
      findMany: mockFn(async () => [
        {
          id: '44444444-4444-4444-8444-444444444444',
          contact: { id: '55555555-5555-4555-8555-555555555555', displayName: 'Sensitive Contact' },
          assignee: { id: agent.id, name: agent.name },
        },
      ]),
    },
    cliSession: {
      create: mockFn(async ({ data }) => {
        const session = {
          id: `33333333-3333-4333-8333-${String(sessions.length + 1).padStart(12, '0')}`,
          ...data,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        sessions.push(session);
        return session;
      }),
      findMany: mockFn(async ({ where }) =>
        sessions
          .filter((session) => session.tokenPrefix === where.tokenPrefix)
          .map((session) => ({ ...session, agent })),
      ),
      update: mockFn(async ({ where, data }) => {
        const session = sessions.find((row) => row.id === where.id);
        if (session) Object.assign(session, data);
        return session;
      }),
      updateMany: mockFn(async ({ where, data }) => {
        let count = 0;
        for (const session of sessions) {
          if (session.id === where.id && session.tenantId === where.tenantId) {
            Object.assign(session, data);
            count++;
          }
        }
        return { count };
      }),
    },
  };
  return prisma;
}

async function createApp(prisma: ReturnType<typeof createPrismaMock>) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  loadEnvConfig();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(cliRoutes, { prefix: '/api/v1/cli' });
  return app;
}

async function testCliSessionServiceLifecycle() {
  const agent = createAgent(await hashPassword('secret'));
  const prisma = createPrismaMock(agent);

  const { token, session } = await createCliSession(prisma as never, {
    tenantId: agent.tenantId,
    agentId: agent.id,
    name: 'local-dev',
  });

  assert.match(token, /^cli_/);
  assert.notEqual(session.tokenHash, token);
  assert.equal(session.tokenPrefix.startsWith('cli_'), true);

  const verified = await verifyCliSession(prisma as never, token);
  assert.equal(verified.ok, true);
  if (!verified.ok) assert.fail('expected valid CLI token');
  assert.deepEqual(verified.scopes, ['cli:status', 'cli:apis']);
  assert.equal(prisma.cliSession.update.calls.length, 1);

  prisma._sessions[0].expiresAt = new Date(Date.now() - 1_000);
  const expired = await verifyCliSession(prisma as never, token);
  assert.deepEqual(expired, { ok: false, reason: 'CLI token expired' });

  prisma._sessions[0].expiresAt = new Date(Date.now() + 60_000);
  prisma._sessions[0].revokedAt = new Date();
  const revoked = await verifyCliSession(prisma as never, token);
  assert.deepEqual(revoked, { ok: false, reason: 'CLI token revoked' });
}

async function testCliAuthRoutes() {
  const agent = createAgent(await hashPassword('secret'));
  const prisma = createPrismaMock(agent);
  const app = await createApp(prisma);

  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/login',
      payload: { email: agent.email, password: 'secret', profile: 'test' },
    });
    assert.equal(login.statusCode, 200);
    const loginJson = login.json();
    const token = loginJson.data.token as string;
    assert.match(token, /^cli_/);
    assert.equal(prisma._sessions[0].tokenHash === token, false);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().data.email, agent.email);

    prisma._sessions[0].scopes = ['cli:status'];
    const insufficient = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/apis',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(insufficient.statusCode, 403);
    assert.equal(insufficient.json().error.code, 'INSUFFICIENT_SCOPE');

    prisma._sessions[0].scopes = ['cli:status', 'cli:apis'];
    const apis = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/apis',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(apis.statusCode, 200);
    assert.equal(apis.json().data.capabilities.length >= 2, true);
    assert.equal(apis.json().data.endpoints.length >= 3, true);
    assert.equal(apis.json().data.endpoints[0].method, 'GET');
    assert.equal(typeof apis.json().data.endpoints[0].path, 'string');
    assert.equal(typeof apis.json().data.endpoints[0].params, 'object');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(logout.statusCode, 200);
    assert.ok(prisma._sessions[0].revokedAt instanceof Date);

    const rejected = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(rejected.statusCode, 401);

    const invalidLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/login',
      payload: { email: agent.email, password: 'wrong', profile: 'test' },
    });
    assert.equal(invalidLogin.statusCode, 401);
  } finally {
    await app.close();
  }
}

async function testCliAnalyticsRoutes() {
  const agent = createAgent(await hashPassword('secret'));
  const prisma = createPrismaMock(agent);
  const app = await createApp(prisma);

  try {
    const { token } = await createCliSession(prisma as never, {
      tenantId: agent.tenantId,
      agentId: agent.id,
      name: 'analytics-test',
    });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/analytics/overview',
      headers: { authorization: 'Bearer cli_invalid' },
    });
    assert.equal(invalid.statusCode, 401);

    const insufficient = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/analytics/overview',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(insufficient.statusCode, 403);
    assert.equal(insufficient.json().error.code, 'INSUFFICIENT_SCOPE');

    const hiddenDiscovery = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/apis',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(hiddenDiscovery.statusCode, 200);
    assert.equal(
      hiddenDiscovery.json().data.capabilities.some((capability: any) => capability.name === 'statistics'),
      false,
    );

    prisma._sessions[0].scopes = ['cli:status', 'cli:apis', 'cli:analytics:read'];

    const visibleDiscovery = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/apis',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(visibleDiscovery.statusCode, 200);
    assert.equal(
      visibleDiscovery.json().data.capabilities.some((capability: any) => capability.name === 'statistics'),
      true,
    );

    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/analytics/overview?from=2026-06-01&to=2026-06-30',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().data.totalMessages, 10);
    assert.equal(overview.json().data.openCases, 2);

    const cases = await app.inject({
      method: 'GET',
      url: '/api/v1/cli/analytics/cases?from=2026-06-01&to=2026-06-30',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(cases.statusCode, 200);
    assert.equal(cases.json().data.slaViolationCount, 1);
    assert.equal('slaViolations' in cases.json().data, false);
  } finally {
    await app.close();
  }
}

await testCliSessionServiceLifecycle();
await testCliAuthRoutes();
await testCliAnalyticsRoutes();

console.log('cli-session-auth tests passed');
process.exit(0);
