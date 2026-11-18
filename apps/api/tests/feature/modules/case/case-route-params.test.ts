/**
 * 工單路由的路徑參數（case-management「工單路由驗證路徑參數」）：
 * `:id`、`:tagId`、`:conversationId` 不是 UUID 時回 400 `VALIDATION_ERROR`，錯誤指向該參數，不讀寫資料。
 * 屬於 feature 組：走真實路由與權限檢查（權限查詢需要資料庫）。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import caseRoutes from '#src/modules/case/case.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-case-route-params-${Date.now()}`;
const io = { to: () => ({ emit: () => {} }), of: () => ({ to: () => ({ emit: () => {} }) }) };

const role = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-role`,
    name: `${MARK}-role`,
    permissions: {
      create: ['case.view', 'case.create', 'case.update', 'case.assign', 'case.escalate', 'case.delete']
        .map((permissionCode) => ({ permissionCode })),
    },
  },
});
const agent = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}-member@example.test`, name: MARK, passwordHash: 'x' },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', io as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
});
await app.register(caseRoutes, { prefix: '/api/v1/cases' });
await app.ready();

afterAll(async () => {
  await app.close();
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const BAD = 'not-a-uuid';
const OK = '00000000-0000-4000-8000-000000000000';

// [method, url, 不合法的參數]
const cases: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, string]> = [
  ['GET', `/${BAD}`, 'id'],
  ['PATCH', `/${BAD}`, 'id'],
  ['DELETE', `/${BAD}`, 'id'],
  ['POST', `/${BAD}/tags`, 'id'],
  ['DELETE', `/${BAD}/tags/${OK}`, 'id'],
  ['DELETE', `/${OK}/tags/${BAD}`, 'tagId'],
  ['GET', `/${BAD}/events`, 'id'],
  ['POST', `/${BAD}/notes`, 'id'],
  ['POST', `/${BAD}/assign`, 'id'],
  ['POST', `/${BAD}/resolve`, 'id'],
  ['POST', `/${BAD}/close`, 'id'],
  ['POST', `/${BAD}/reopen`, 'id'],
  ['POST', `/${BAD}/escalate`, 'id'],
  ['POST', `/${BAD}/conversations/${OK}/link`, 'id'],
  ['POST', `/${OK}/conversations/${BAD}/link`, 'conversationId'],
  ['POST', `/${BAD}/csat`, 'id'],
  ['POST', `/from-conversation/${BAD}`, 'conversationId'],
];

describe('工單路由驗證路徑參數', () => {
  it.each(cases)('路徑參數不是 UUID：%s %s', async (method, url, param) => {
    const res = await app.inject({ method, url: `/api/v1/cases${url}`, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
    assert.equal(res.statusCode, 400, res.body);
    const error = res.json().error;
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.deepEqual(error.details.issues.map((i: { path: string }) => i.path), [param]);
  });
});
