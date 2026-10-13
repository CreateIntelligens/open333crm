/**
 * 升級工單的通知對象只接受固定值（change fix-w6-field-validation，spec case-management
 * 「Escalation Notify Targets Are Validated」；UAT E2E BUG-W6-06）。
 *
 * 屬於 feature 組：走真實的 requirePermission 與權限計算，連線設定由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import caseRoutes from '#src/modules/case/case.routes.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const AGENT_ID = '00000000-0000-4000-8000-0000000000ce';
const MISSING_CASE = '00000000-0000-4000-8000-0000000000cf';
const stamp = Date.now();

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-escalate-${stamp}`,
    name: 'CI 升級通知對象',
    permissions: { create: ['case.view', 'case.escalate'].map((permissionCode) => ({ permissionCode })) },
  },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: AGENT_ID, tenantId: T, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(caseRoutes, { prefix: '/api/v1/cases' });
await app.ready();

afterAll(async () => {
  await app.close();
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

const escalate = (notifyTargets: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/cases/${MISSING_CASE}/escalate`,
    payload: { reason: 'ci', newPriority: 'HIGH', notifyTargets },
  });

test('Invalid notify target：notifyTargets 含固定值以外的字串回 400', async () => {
  const res = await escalate(['everyone']);
  assert.equal(res.statusCode, 400);
  const issues = (res.json() as { error?: { details?: { issues?: Array<{ path: string }> } } }).error?.details?.issues ?? [];
  assert.ok(issues.some((i) => i.path.startsWith('notifyTargets')), '錯誤應指出 notifyTargets');
});

test('合法的通知對象通過驗證（工單不存在時回 404，不是 400）', async () => {
  const res = await escalate(['supervisor', 'original_assignee']);
  assert.notEqual(res.statusCode, 400);
});

test('升級對話框的「通知團隊」送出 team 不可被擋（2026-10-12 UAT 回歸）', async () => {
  // EscalationModal 有第三個勾選「通知團隊」，送出 team；只允許兩個值時客服勾了它升級就會 400
  const res = await escalate(['supervisor', 'original_assignee', 'team']);
  assert.notEqual(res.statusCode, 400, res.body);
});
