/**
 * 廣播不可排程到過去（change fix-w6-marketing-validation，spec marketing-scheduling
 * 「Broadcast Schedule Is In The Future」；UAT E2E CM-W6-02）。
 *
 * 排程器每 60 秒取 scheduledAt <= now 的廣播執行：排到過去的廣播會在一分鐘內立即發送給客人。
 * 檢查放在 createBroadcast()，REST 與 MCP 都經過它。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createBroadcast } from '#src/modules/marketing/marketing.service.js';

const T = 'tenant-a';

function fakeDb() {
  const created: Array<Record<string, unknown>> = [];
  const db = {
    material: { findFirst: async () => ({ id: 'mat-1', tenantId: T }) },
    channel: { findFirst: async () => ({ id: 'ch-1', tenantId: T, isActive: true }) },
    broadcast: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'b1', ...data };
      },
    },
  };
  return { db: db as never, created };
}

const base = { name: 'x', materialId: 'mat-1', channelId: 'ch-1', targetType: 'all' as const };

test('Schedule in the past：排到過去回 400 指出 scheduledAt，不建立', async () => {
  const { db, created } = fakeDb();
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, scheduledAt: '2020-01-01T00:00' }),
    (e: { statusCode?: number; details?: { issues?: Array<{ path: string }> } }) => {
      assert.equal(e.statusCode, 400);
      assert.ok(e.details?.issues?.some((i) => i.path === 'scheduledAt'), '錯誤應指出 scheduledAt');
      return true;
    },
  );
  assert.equal(created.length, 0);
});

test('無法解析的排程時間回 400', async () => {
  const { db, created } = fakeDb();
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, scheduledAt: 'garbage' }),
    (e: { statusCode?: number }) => e.statusCode === 400,
  );
  assert.equal(created.length, 0);
});

test('Schedule in the future：一小時後的排程建立為 scheduled', async () => {
  const { db, created } = fakeDb();
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await createBroadcast(db, T, 'agent-1', { ...base, scheduledAt });
  assert.equal(created[0]?.status, 'scheduled');
});

test('No schedule：沒有排程時間建立為草稿', async () => {
  const { db, created } = fakeDb();
  await createBroadcast(db, T, 'agent-1', base);
  assert.equal(created[0]?.status, 'draft');
});

test('空字串的排程時間視為沒有排程，建立為草稿（不會發送）', async () => {
  const { db, created } = fakeDb();
  await createBroadcast(db, T, 'agent-1', { ...base, scheduledAt: '' });
  assert.equal(created[0]?.status, 'draft');
});
