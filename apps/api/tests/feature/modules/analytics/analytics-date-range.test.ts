/**
 * 分析 API 的日期區間要先後正確（change fix-w6-field-validation，spec analytics-reports
 * 「Analytics Date Range Must Be Ordered」）。原本 from 晚於 to 時回傳全 0 報表，使用者以為沒有資料。
 *
 * 屬於 feature 組：走真實路由、權限與資料庫。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import analyticsRoutes from '#src/modules/analytics/analytics.routes.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-analytics-${stamp}`,
    name: 'CI 分析日期區間',
    permissions: { create: ['analytics.view'].map((permissionCode) => ({ permissionCode })) },
  },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: '00000000-0000-4000-8000-0000000000d3', tenantId: T, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
await app.ready();

afterAll(async () => {
  await app.close();
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

const issuePaths = (res: { json: () => unknown }) =>
  ((res.json() as { error?: { details?: { issues?: Array<{ path: string }> } } }).error?.details?.issues ?? []).map(
    (i) => i.path,
  );

test('Reversed date range：from 晚於 to 回 400 並指出 from（各分析端點一致）', async () => {
  for (const path of ['overview', 'message-trend', 'cases', 'agents', 'channels']) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/${path}?from=2026-12-31&to=2020-01-01`,
    });
    assert.equal(res.statusCode, 400, `${path}：${res.body}`);
    assert.ok(issuePaths(res).includes('from'), `${path} 應指出 from`);
  }
});

test('Same day：from 與 to 相同時回傳報表', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/analytics/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
  });
  assert.equal(res.statusCode, 200, res.body);
});
