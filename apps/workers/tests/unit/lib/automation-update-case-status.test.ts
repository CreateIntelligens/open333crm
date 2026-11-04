/**
 * update_case_status worker 動作維護 resolvedAt（issue #417，AUDIT AUTO-10）。
 * 與 API 的 transitionCase() 用同一個規則（@open333crm/shared 的 caseTransitionTimestamps）：
 * 轉成 RESOLVED 寫入解決時間；RESOLVED → CLOSED 保留；直接關閉不寫；重開清除。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

interface FakeCase {
  id: string;
  tenantId: string;
  status: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

const RESOLVED_AT = new Date('2026-01-02T00:00:00Z');

function makePrisma(row: FakeCase) {
  const matches = (where: Record<string, unknown>) =>
    where.id === row.id &&
    (where.tenantId === undefined || where.tenantId === row.tenantId) &&
    (where.status === undefined || where.status === row.status);
  const apply = (data: Record<string, unknown>) => Object.assign(row, data);
  return {
    case: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return matches(where) ? { ...row } : null;
      },
      async findUnique({ where }: { where: Record<string, unknown> }) {
        return matches(where) ? { ...row } : null;
      },
      async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        if (!matches(where)) throw new Error('not found');
        return apply(data);
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        if (!matches(where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      },
    },
  };
}

const published: string[] = [];
const redisPublisher = {
  publish: async (_channel: string, message: string) => {
    published.push(message);
    return 1;
  },
};

async function run(row: FakeCase, status: string, tenantId = 'tenant-1') {
  await executeWorkerAutomationActions(
    makePrisma(row) as never,
    redisPublisher as never,
    [{ type: 'update_case_status', params: { status } } as never],
    { tenantId, caseId: row.id } as never,
  );
}

const caseOf = (status: string, resolvedAt: Date | null): FakeCase => ({
  id: 'case-1',
  tenantId: 'tenant-1',
  status,
  resolvedAt,
  closedAt: null,
});

test('規則轉成 RESOLVED：寫入 resolvedAt', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'RESOLVED');
  assert.equal(row.status, 'RESOLVED');
  assert.ok(row.resolvedAt instanceof Date);
});

test('規則把 RESOLVED 改回 IN_PROGRESS：清除 resolvedAt', async () => {
  const row = caseOf('RESOLVED', RESOLVED_AT);
  await run(row, 'IN_PROGRESS');
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal(row.resolvedAt, null);
});

test('規則把 CLOSED 改回 OPEN：清除 resolvedAt', async () => {
  const row = caseOf('CLOSED', RESOLVED_AT);
  await run(row, 'OPEN');
  assert.equal(row.resolvedAt, null);
});

test('規則直接關閉：不寫 resolvedAt，寫 closedAt', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'CLOSED');
  assert.equal(row.status, 'CLOSED');
  assert.equal(row.resolvedAt, null);
  assert.ok(row.closedAt instanceof Date);
});

test('規則把 RESOLVED 改成 CLOSED：保留 resolvedAt', async () => {
  const row = caseOf('RESOLVED', RESOLVED_AT);
  await run(row, 'CLOSED');
  assert.equal(row.resolvedAt, RESOLVED_AT);
  assert.ok(row.closedAt instanceof Date);
});

test('其他租戶的工單：不改', async () => {
  const row = caseOf('RESOLVED', RESOLVED_AT);
  await run(row, 'IN_PROGRESS', 'tenant-2');
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.resolvedAt, RESOLVED_AT);
});
