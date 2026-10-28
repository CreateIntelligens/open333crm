/**
 * 建立工單時優先套用預設政策（change fix-admin-settings-safeguards，sla-policy-selection；AUDIT SLA-03）。
 * G20：「設為此優先級預設」沒有作用，同優先級多條政策時挑哪條由資料庫決定。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createCase } from '#src/modules/case/case.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';

interface Policy { id: string; tenantId: string; name: string; priority: string; isDefault: boolean; createdAt: Date; resolutionMinutes: number }

/** 依 Prisma 的 orderBy 排序（模擬資料庫）；沒有 orderBy 時回傳插入順序的第一筆 */
function sortBy(rows: Policy[], orderBy?: Array<Record<string, 'asc' | 'desc'>> | Record<string, 'asc' | 'desc'>) {
  const keys = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const [field, dir] = Object.entries(k)[0] as [keyof Policy, 'asc' | 'desc'];
      const av = Number(a[field] instanceof Date ? (a[field] as Date).getTime() : a[field]);
      const bv = Number(b[field] instanceof Date ? (b[field] as Date).getTime() : b[field]);
      if (av !== bv) return dir === 'asc' ? av - bv : bv - av;
    }
    return 0;
  });
}

function mockPrisma(policies: Policy[]) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    slaPolicy: {
      findFirst: async ({ where, orderBy }: { where: Partial<Policy>; orderBy?: never }) => {
        const rows = policies.filter((p) => p.tenantId === where.tenantId && (!where.priority || p.priority === where.priority));
        return sortBy(rows, orderBy)[0] ?? null;
      },
    },
    case: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'case-1', teamId: null, channelId: data.channelId, ...data };
        created.push(row);
        return row;
      },
    },
    caseEvent: { create: async () => ({}) },
    // createCase 會檢查聯絡人在該渠道有帳號（S10，commit 7c53d9be）
    channelIdentity: { findFirst: async () => ({ id: 'identity-1' }) },
  };
  return { prisma, created };
}

const input = { contactId: 'c1', channelId: 'ch1', title: '測試', priority: 'HIGH' as const };
const policy = (id: string, isDefault: boolean, createdAt: string, resolutionMinutes: number): Policy => ({
  id, tenantId: TENANT, name: id, priority: 'HIGH', isDefault, createdAt: new Date(createdAt), resolutionMinutes,
});

test('同優先級有多條政策時套用預設', async () => {
  const { prisma, created } = mockPrisma([
    policy('A', false, '2026-01-01', 60),
    policy('B', true, '2026-02-01', 240),
  ]);
  const before = Date.now();
  await createCase(createMockTenantCtx(prisma, TENANT).ctx, 'agent-1', input);
  assert.equal(created[0].slaPolicy, 'B');
  const due = (created[0].slaDueAt as Date).getTime();
  assert.ok(due >= before + 240 * 60_000 && due <= Date.now() + 240 * 60_000, '到期時間依 B 的解決時限');
});

test('沒有預設政策時套用最早建立的', async () => {
  const { prisma, created } = mockPrisma([
    policy('C', false, '2026-03-01', 30),
    policy('A', false, '2026-01-01', 60),
  ]);
  await createCase(createMockTenantCtx(prisma, TENANT).ctx, 'agent-1', input);
  assert.equal(created[0].slaPolicy, 'A');
});
