import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { test } from 'vitest';
import platformRoutes from '#src/modules/platform/platform.routes.js';
import errorHandler from '#src/plugins/error-handler.plugin.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';

async function fixture() {
  const settings = new Map<string, unknown>();
  const audits: Array<Record<string, unknown>> = [];
  let failAudit = false;
  const db = {
    tenant: { findUnique: async ({ where }: { where: { id: string } }) => [A, B].includes(where.id) ? { id: where.id } : null },
    platformSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => settings.has(where.key) ? { value: settings.get(where.key) } : null,
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        settings.set(where.key, create.value);
      },
    },
    platformAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => {
      if (failAudit) throw new Error('audit failed');
      audits.push(data);
    } },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const snapshot = new Map(settings);
      try { return await fn(db); } catch (error) {
        settings.clear();
        for (const [key, value] of snapshot) settings.set(key, value);
        throw error;
      }
    },
  };
  const app = Fastify();
  app.decorate('prismaAdmin', db as never);
  app.decorateRequest('platformUser', null);
  app.decorate('authenticatePlatformSuperuser', async (request: any, reply: any) => {
    if (!['platform', 'change-password'].includes(request.headers.authorization)) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }
    request.platformUser = { id: ACTOR, mustChangePassword: request.headers.authorization === 'change-password' };
  });
  await app.register(errorHandler);
  await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  const call = (method: 'GET' | 'PATCH', tenantId = A, payload?: unknown, authorization = 'platform') => app.inject({
    method, url: `/api/v1/platform/tenants/${tenantId}/ai-privacy`, headers: { authorization }, payload,
  });
  return { app, call, settings, audits, failNextAudit: () => { failAudit = true; } };
}

test('Default off and isolated tenants', async () => {
  const f = await fixture();
  try {
    const initial = await f.call('GET');
    assert.equal(initial.statusCode, 200);
    assert.deepEqual(initial.json().data, { enabled: false });
    assert.equal((await f.call('PATCH', A, { enabled: true })).statusCode, 200);
    assert.deepEqual((await f.call('GET', A)).json().data, { enabled: true });
    assert.deepEqual((await f.call('GET', B)).json().data, { enabled: false });
  } finally { await f.app.close(); }
});

test('Authorized enable and disable', async () => {
  const f = await fixture();
  try {
    for (const enabled of [true, false]) {
      const response = await f.call('PATCH', A, { enabled });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().data, { enabled });
      assert.deepEqual(f.audits.at(-1), {
        platformUserId: ACTOR, action: 'tenant.ai_privacy.update', targetType: 'tenant', targetId: A, payload: { enabled },
      });
    }
    f.failNextAudit();
    assert.equal((await f.call('PATCH', A, { enabled: true })).statusCode, 500);
    assert.deepEqual((await f.call('GET')).json().data, { enabled: false }, 'setting rolls back with failed audit');
  } finally { await f.app.close(); }
});

test('Rejected administrative requests', async () => {
  const f = await fixture();
  try {
    for (const token of ['', 'tenant-admin']) {
      for (const method of ['GET', 'PATCH'] as const) {
        assert.equal((await f.call(method, A, method === 'PATCH' ? { enabled: true } : undefined, token)).statusCode, 401);
      }
    }
    for (const method of ['GET', 'PATCH'] as const) {
      assert.equal((await f.call(method, A, method === 'PATCH' ? { enabled: true } : undefined, 'change-password')).statusCode, 403);
    }
    for (const payload of [{}, { enabled: 'true' }, { enabled: true, tenantOverride: true }]) {
      assert.equal((await f.call('PATCH', A, payload)).statusCode, 400);
    }
    assert.equal((await f.call('GET', '44444444-4444-4444-8444-444444444444')).statusCode, 404);
    assert.equal((await f.call('PATCH', '44444444-4444-4444-8444-444444444444', { enabled: true })).statusCode, 404);
    assert.equal((await f.call('GET', 'invalid-id')).statusCode, 400);
    assert.equal(f.settings.size, 0);
    assert.equal(f.audits.length, 0);
  } finally { await f.app.close(); }
});
