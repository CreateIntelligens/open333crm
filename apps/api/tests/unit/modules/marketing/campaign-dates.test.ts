/**
 * 行銷活動的結束日不可早於開始日（change fix-w6-marketing-validation，spec marketing-scheduling
 * 「Campaign End Date Is Not Before Start Date」；UAT E2E CM-W6-01）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createCampaign, updateCampaign } from '#src/modules/marketing/campaign.service.js';

const T = 'tenant-a';

function fakeDb(existing?: { id: string; status: string; startDate: Date | null; endDate: Date | null }) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    campaign: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'new', ...data };
      },
      findFirst: async () => (existing ? { tenantId: T, ...existing } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { ...existing, ...data };
      },
    },
  };
  return { db: db as never, writes };
}

/** 斷言是 400 且 details.issues 指出指定欄位 */
function isFieldError(field: string) {
  return (e: { statusCode?: number; details?: { issues?: Array<{ path: string }> } }) => {
    assert.equal(e.statusCode, 400);
    assert.ok(e.details?.issues?.some((i) => i.path === field), `錯誤應指出 ${field}`);
    return true;
  };
}

test('Create with reversed dates：結束早於開始回 400 指出 endDate，不建立', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(
    createCampaign(db, T, 'agent-1', { name: 'x', startDate: '2026-12-31', endDate: '2026-01-01' }),
    isFieldError('endDate'),
  );
  assert.equal(writes.length, 0);
});

test('Update only the end date：以更新後的起訖比對，早於開始日回 400，不更新', async () => {
  const { db, writes } = fakeDb({
    id: 'c1',
    status: 'draft',
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: new Date('2026-06-30T00:00:00Z'),
  });
  await assert.rejects(updateCampaign(db, 'c1', T, { endDate: '2026-05-01' }), isFieldError('endDate'));
  assert.equal(writes.length, 0);
});

test('Same day：起訖同一天可建立', async () => {
  const { db, writes } = fakeDb();
  await createCampaign(db, T, 'agent-1', { name: 'x', startDate: '2026-06-01', endDate: '2026-06-01' });
  assert.equal(writes.length, 1);
});

test('無法解析的日期字串回 400', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    createCampaign(db, T, 'agent-1', { name: 'x', startDate: 'garbage' }),
    isFieldError('startDate'),
  );
});

test('清除結束日（null）不檢查先後', async () => {
  const { db, writes } = fakeDb({
    id: 'c1',
    status: 'draft',
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: new Date('2026-06-30T00:00:00Z'),
  });
  await updateCampaign(db, 'c1', T, { endDate: null });
  assert.equal(writes.length, 1);
});
