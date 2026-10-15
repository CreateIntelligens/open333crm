/**
 * SLA 政策的命名、改名與刪除（change fix-admin-settings-safeguards，sla-policy-selection；AUDIT SLA-04）。
 * 工單以政策「名稱」記錄套用的政策：改名或刪除後，舊工單在 SLA 掃描時找不到政策，默默停止計時（G20）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createSlaPolicy,
  deleteSlaPolicy,
  updateSlaPolicy,
} from '#src/modules/sla/sla.service.js';

const T = 'a0000000-0000-0000-0000-000000000001';

interface Policy { id: string; tenantId: string; name: string; priority: string; isDefault: boolean }
interface Case { id: string; tenantId: string; slaPolicy: string | null; status: string }

function db(policies: Policy[], cases: Case[] = []) {
  const matches = <R extends Record<string, unknown>>(row: R, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'NOT') return !matches(row, v as Record<string, unknown>);
      if (v && typeof v === 'object' && 'notIn' in (v as object)) return !(v as { notIn: unknown[] }).notIn.includes(row[k]);
      if (v && typeof v === 'object' && 'not' in (v as object)) return row[k] !== (v as { not: unknown }).not;
      return row[k] === v;
    });
  const tx = {
    $executeRaw: async () => 1,
    slaPolicy: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        policies.find((p) => matches(p as never, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Policy> }) => {
        const rows = policies.filter((p) => matches(p as never, where));
        rows.forEach((p) => Object.assign(p, data));
        return { count: rows.length };
      },
      create: async ({ data }: { data: Policy }) => {
        const row = { id: `p${policies.length + 1}`, ...data };
        policies.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Policy> }) => {
        const row = policies.find((p) => p.id === where.id)!;
        return Object.assign(row, data);
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = policies.findIndex((p) => p.id === where.id);
        return policies.splice(i, 1)[0];
      },
    },
    case: {
      count: async ({ where }: { where: Record<string, unknown> }) => cases.filter((c) => matches(c as never, where)).length,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Case> }) => {
        const rows = cases.filter((c) => matches(c as never, where));
        rows.forEach((c) => Object.assign(c, data));
        return { count: rows.length };
      },
    },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { prisma: prisma as never, policies, cases };
}

const base = { priority: 'HIGH' as const, firstResponseMinutes: 30, resolutionMinutes: 240, warningBeforeMinutes: 30, isDefault: false };
const p = (id: string, name: string, extra: Partial<Policy> = {}): Policy => ({ id, tenantId: T, name, priority: 'HIGH', isDefault: false, ...extra });
const c = (id: string, slaPolicy: string, status = 'OPEN'): Case => ({ id, tenantId: T, slaPolicy, status });

test('建立同名政策被拒', async () => {
  const { prisma, policies } = db([p('p1', 'VIP')]);
  await assert.rejects(createSlaPolicy(prisma, T, { ...base, name: 'VIP' }), (err: { code?: string; statusCode?: number }) => {
    assert.equal(err.code, 'DUPLICATE');
    assert.equal(err.statusCode, 409);
    return true;
  });
  assert.equal(policies.length, 1);
});

test('改名成已存在的名稱被拒', async () => {
  const { prisma, policies } = db([p('p1', 'VIP'), p('p2', '標準')]);
  await assert.rejects(updateSlaPolicy(prisma, T, 'p2', { name: 'VIP' }), (err: { code?: string }) => err.code === 'DUPLICATE');
  assert.equal(policies[1].name, '標準');
});

test('改名後舊工單記錄新名稱', async () => {
  const { prisma, cases } = db([p('p1', '標準')], [c('k1', '標準'), c('k2', '其他')]);
  await updateSlaPolicy(prisma, T, 'p1', { name: '標準服務' });
  assert.equal(cases[0].slaPolicy, '標準服務');
  assert.equal(cases[1].slaPolicy, '其他', '其他政策的工單不受影響');
});

test('設為預設時取消同優先級的其他預設', async () => {
  const { prisma, policies } = db([p('p1', 'A', { isDefault: true }), p('p2', 'B')]);
  await updateSlaPolicy(prisma, T, 'p2', { isDefault: true });
  assert.deepEqual(policies.map((x) => x.isDefault), [false, true]);
});

test('有未結案工單的政策不能刪除', async () => {
  const { prisma, policies } = db([p('p1', '標準')], [c('k1', '標準', 'OPEN'), c('k2', '標準', 'IN_PROGRESS'), c('k3', '標準', 'CLOSED')]);
  await assert.rejects(deleteSlaPolicy(prisma, T, 'p1'), (err: { code?: string; statusCode?: number; details?: { openCaseCount?: number } }) => {
    assert.equal(err.code, 'SLA_POLICY_IN_USE');
    assert.equal(err.statusCode, 409);
    assert.equal(err.details?.openCaseCount, 2);
    return true;
  });
  assert.equal(policies.length, 1);
});

test('只有已結案工單的政策可以刪除', async () => {
  const { prisma, policies } = db([p('p1', '標準')], [c('k1', '標準', 'RESOLVED'), c('k2', '標準', 'CLOSED')]);
  await deleteSlaPolicy(prisma, T, 'p1');
  assert.equal(policies.length, 0);
});

test('其他租戶的政策回 404', async () => {
  const { prisma } = db([{ ...p('p1', '標準'), tenantId: 'b0000000-0000-0000-0000-000000000002' }]);
  await assert.rejects(deleteSlaPolicy(prisma, T, 'p1'), (err: { statusCode?: number }) => err.statusCode === 404);
  await assert.rejects(updateSlaPolicy(prisma, T, 'p1', { name: 'x' }), (err: { statusCode?: number }) => err.statusCode === 404);
});
