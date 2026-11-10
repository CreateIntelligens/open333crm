/**
 * 稽核紀錄附上操作者與對象名稱（change add-platform-tenant-audit-logs，規格 platform-audit-log
 * 「稽核紀錄附上操作者與對象名稱」）。
 *
 * executor 換成只實作 describePlatformAuditLogs 會呼叫的 findMany 的假物件。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { describePlatformAuditLogs } from '#src/modules/platform/platform-audit.service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const PLAN = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const SIGNUP = '66666666-6666-4666-8666-666666666666';
const OPS = { id: '77777777-7777-4777-8777-777777777777', name: 'Ops', email: 'ops@example.com' };

type Row = { id: string; [k: string]: unknown };
function byIds(rows: Row[]) {
  return async ({ where }: { where: { id: { in: string[] } } }) => rows.filter((r) => where.id.in.includes(r.id));
}

function fakeDb(data: {
  tenants?: Row[];
  agents?: Row[];
  plans?: Row[];
  requests?: Row[];
  users?: Row[];
  signups?: Row[];
}) {
  return {
    tenant: { findMany: byIds(data.tenants ?? []) },
    agent: { findMany: byIds(data.agents ?? []) },
    plan: { findMany: byIds(data.plans ?? []) },
    planChangeRequest: { findMany: byIds(data.requests ?? []) },
    platformUser: { findMany: byIds(data.users ?? []) },
    trialSignup: { findMany: byIds(data.signups ?? []) },
  } as unknown as PrismaClient;
}

let seq = 0;
function log(targetType: string | null, targetId: string | null, extra: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `log-${seq}`,
    platformUserId: OPS.id,
    platformUser: OPS,
    action: 'x',
    targetType,
    targetId,
    payload: null,
    createdAt: new Date('2026-11-10T00:00:00Z'),
    ...extra,
  };
}

test('解析各類型對象的名稱', async () => {
  const db = fakeDb({
    tenants: [{ id: TENANT, name: '大同' }],
    agents: [{ id: AGENT, email: 'a@example.com', tenantId: TENANT }],
    plans: [{ id: PLAN, name: '專業版' }],
    requests: [{ id: REQUEST, tenantId: TENANT, tenant: { name: '大同' } }],
    users: [{ id: USER, name: 'Alice' }],
    signups: [{ id: SIGNUP, email: 'trial@example.com', tenantId: null }],
  });
  const result = await describePlatformAuditLogs(db, [
    log('tenant', TENANT),
    log('agent', AGENT, { payload: { tenantId: TENANT } }),
    log('plan', PLAN),
    log('plan_change_request', REQUEST),
    log('platform_user', USER),
    log('trial_signup', SIGNUP),
    log('setting', 'trial.planSlug'),
    log('queue_job', 'notification:42'),
  ]);
  assert.deepEqual(
    result.map((r) => [r.targetLabel, r.targetTenantId]),
    [
      ['大同', TENANT],
      ['a@example.com', TENANT],
      ['專業版', null],
      ['大同', TENANT],
      ['Alice', null],
      ['trial@example.com', null],
      ['trial.planSlug', null],
      ['notification:42', null],
    ],
  );
  assert.deepEqual(result[0]!.actor, OPS);
  // 回應不帶 Prisma relation 原始欄位
  assert.ok(!('platformUser' in result[0]!));
});

test('成員已被刪除', async () => {
  const [entry] = await describePlatformAuditLogs(fakeDb({}), [
    log('agent', AGENT, { action: 'tenant.agent.email.update', payload: { tenantId: TENANT, email: 'new@example.com' } }),
  ]);
  assert.equal(entry!.targetLabel, 'new@example.com');
  assert.equal(entry!.targetTenantId, TENANT);
});

test('方案已不存在', async () => {
  const [entry] = await describePlatformAuditLogs(fakeDb({}), [log('plan', PLAN, { action: 'plan.update' })]);
  assert.equal(entry!.targetLabel, null);
});

test('系統排程寫入的紀錄', async () => {
  const [entry] = await describePlatformAuditLogs(fakeDb({ tenants: [{ id: TENANT, name: '大同' }] }), [
    log('tenant', TENANT, { action: 'tenant.trial.expire', platformUserId: null, platformUser: null }),
  ]);
  assert.equal(entry!.actor, null);
  assert.equal(entry!.targetLabel, '大同');
});
