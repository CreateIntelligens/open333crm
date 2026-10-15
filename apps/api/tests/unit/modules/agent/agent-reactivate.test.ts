/**
 * 重新啟用成員受方案人數上限限制（change fix-admin-settings-safeguards，agent-lifecycle「重新啟用成員」）。
 * 否則「停用 → 建立新成員 → 重新啟用」可以繞過建立時的人數上限。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { reactivateAgent } from '#src/modules/agent/agent.service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function mockPrisma(opts: { maxAgents: number | null; activeCount: number; target?: { isActive: boolean } | null }) {
  const update = vi.fn(async () => ({}));
  const prisma = {
    tenant: {
      findUnique: async () => ({ limitOverrides: opts.maxAgents === null ? null : { maxAgents: opts.maxAgents }, plan: null }),
    },
    agent: {
      findFirst: async ({ where }: { where: { tenantId: string } }) => {
        assert.equal(where.tenantId, TENANT, '查成員要帶 tenantId');
        return opts.target === null ? null : { id: 'm', isActive: opts.target?.isActive ?? false };
      },
      count: async () => opts.activeCount,
      update,
    },
  };
  return { prisma, update };
}

test('重新啟用受方案人數上限限制：已達上限時回 403 PLAN_LIMIT_EXCEEDED，不更新', async () => {
  const { prisma, update } = mockPrisma({ maxAgents: 3, activeCount: 3 });
  await assert.rejects(reactivateAgent(prisma as never, TENANT, 'm'), (err: { code?: string; statusCode?: number }) => {
    assert.equal(err.code, 'PLAN_LIMIT_EXCEEDED');
    assert.equal(err.statusCode, 403);
    return true;
  });
  assert.equal(update.mock.calls.length, 0);
});

test('未達上限時重新啟用', async () => {
  const { prisma, update } = mockPrisma({ maxAgents: 3, activeCount: 2 });
  await reactivateAgent(prisma as never, TENANT, 'm');
  assert.deepEqual((update.mock.calls[0] as unknown as [{ data: unknown }])[0].data, { isActive: true });
});

test('成員不存在回 404', async () => {
  const { prisma } = mockPrisma({ maxAgents: null, activeCount: 0, target: null });
  await assert.rejects(reactivateAgent(prisma as never, TENANT, 'm'), (err: { statusCode?: number }) => err.statusCode === 404);
});

test('已經是啟用中的成員：不檢查上限、不更新', async () => {
  const { prisma, update } = mockPrisma({ maxAgents: 1, activeCount: 5, target: { isActive: true } });
  await reactivateAgent(prisma as never, TENANT, 'm');
  assert.equal(update.mock.calls.length, 0);
});
