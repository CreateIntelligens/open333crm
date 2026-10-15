/**
 * 分群條件要有值（change fix-broadcast-audience-fail-closed，spec broadcast-audience
 * 「Segment Conditions Have Values」）。
 *
 * 修正前：前端把空值條件濾掉、剩 0 條時，後端 calculateSegmentContacts() 回傳全部聯絡人，
 * 「LINE 會員」分群實際上是全部人，拿去廣播就是全發。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  calculateSegmentContacts,
  createSegment,
  updateSegment,
} from '#src/modules/marketing/segment.service.js';

const T = 'tenant-a';

function fakeDb() {
  const created: Array<Record<string, unknown>> = [];
  const contactQueries: unknown[] = [];
  const db = {
    contact: {
      findMany: async (args: unknown) => {
        contactQueries.push(args);
        return [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }];
      },
    },
    segment: {
      findFirst: async () => ({ id: 's-1', tenantId: T }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 's-1', ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: 's-1', ...data }),
    },
  };
  return { db: db as never, created, contactQueries };
}

type AppErr = { statusCode?: number; code?: string };

test('Create a segment with an empty condition value：條件值空白回 400 INVALID_SEGMENT_RULES', async () => {
  const { db, created } = fakeDb();
  await assert.rejects(
    createSegment(db, T, 'agent-1', {
      name: 'LINE 會員',
      rules: { logic: 'AND', conditions: [{ field: 'channelType', operator: 'eq', value: '' }] },
    }),
    (e: AppErr) => {
      assert.equal(e.statusCode, 400);
      assert.equal(e.code, 'INVALID_SEGMENT_RULES');
      return true;
    },
  );
  assert.equal(created.length, 0);
});

test('Create a segment with no conditions：沒有條件回 400 INVALID_SEGMENT_RULES', async () => {
  const { db, created } = fakeDb();
  await assert.rejects(
    createSegment(db, T, 'agent-1', { name: '全部', rules: { logic: 'AND', conditions: [] } }),
    (e: AppErr) => e.statusCode === 400 && e.code === 'INVALID_SEGMENT_RULES',
  );
  assert.equal(created.length, 0);
});

test('一條有值、一條空值也拒絕（空值條件會讓 AND 變寬鬆）', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    createSegment(db, T, 'agent-1', {
      name: 'x',
      rules: {
        logic: 'AND',
        conditions: [
          { field: 'channelType', operator: 'eq', value: 'LINE' },
          { field: 'tag', operator: 'eq', value: '' },
        ],
      },
    }),
    (e: AppErr) => e.code === 'INVALID_SEGMENT_RULES',
  );
});

test('修改分群規則為空條件也拒絕', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    updateSegment(db, 's-1', T, { rules: { logic: 'OR', conditions: [] } }),
    (e: AppErr) => e.code === 'INVALID_SEGMENT_RULES',
  );
});

test('Preview rules without conditions：沒有有效條件的人數是 0，不查全部聯絡人', async () => {
  const { db, contactQueries } = fakeDb();
  const empty = await calculateSegmentContacts(db, T, { logic: 'AND', conditions: [] });
  assert.equal(empty.count, 0);
  const blank = await calculateSegmentContacts(db, T, {
    logic: 'AND',
    conditions: [{ field: 'channelType', operator: 'eq', value: '' }],
  });
  assert.equal(blank.count, 0);
  assert.equal(contactQueries.length, 0);
});

test('有值的條件照常建立', async () => {
  const { db, created } = fakeDb();
  await createSegment(db, T, 'agent-1', {
    name: 'LINE 會員',
    rules: { logic: 'AND', conditions: [{ field: 'channelType', operator: 'eq', value: 'LINE' }] },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].contactCount, 3);
});
