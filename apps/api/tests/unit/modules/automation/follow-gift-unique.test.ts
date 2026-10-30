/**
 * 加好友禮每個租戶只能有一條（add-coupon-system design D28；使用者決定 2026-10-22：後端也擋）。
 * 設定頁只編輯一條規則，但經 API 或其他入口另外建立的同類規則也會執行，同一位顧客可能拿到兩張券。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRule, updateRule } from '#src/modules/automation/automation.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const T = 'tenant-a';
const COUPON = '11111111-1111-4111-8111-111111111111';

type Rule = { id: string; tenantId: string; enabled: boolean; eventType: string; actions: unknown; trigger?: unknown; conditions?: unknown };

function fakeDb(rules: Rule[]) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    coupon: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return where.id.in.filter((id) => id === COUPON).map((id) => ({ id }));
      },
    },
    automationRule: {
      async findMany({ where }: { where: { tenantId: string; enabled?: boolean; eventType?: string; id?: { not: string } } }) {
        return rules.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            (where.enabled === undefined || r.enabled === where.enabled) &&
            (where.eventType === undefined || r.eventType === where.eventType) &&
            (where.id === undefined || r.id !== where.id.not),
        );
      },
      async findFirst({ where }: { where: { id: string; tenantId: string } }) {
        return rules.find((r) => r.id === where.id && r.tenantId === where.tenantId && r.enabled) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        writes.push(data);
        return { id: 'new', ...data };
      },
      async update({ data }: { data: Record<string, unknown> }) {
        writes.push(data);
        return { id: 'r1', ...data };
      },
    },
  };
  return { db: db as never, writes };
}

const followGift = (actions: unknown = [{ type: 'issue_coupon', params: { couponId: COUPON } }]) => ({
  name: '加好友禮',
  trigger: { type: 'contact.followed' },
  conditions: { all: [{ fact: 'follow.isFirst', operator: 'equal', value: true }] },
  actions: actions as Array<Record<string, unknown>>,
});

const existingGift: Rule = {
  id: 'r1',
  tenantId: T,
  enabled: true,
  eventType: 'contact.followed',
  trigger: { type: 'contact.followed' },
  conditions: { all: [{ fact: 'follow.isFirst', operator: 'equal', value: true }] },
  actions: [{ type: 'issue_coupon', params: { couponId: COUPON } }],
};

const isConflict = (e: { statusCode?: number; message?: string }) =>
  e.statusCode === 409 && /加好友禮/.test(e.message ?? '');

test('已經有加好友禮時，再建立一條含發券的加入好友規則：回 409，不儲存', async () => {
  const { db, writes } = fakeDb([existingGift]);
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, followGift()), isConflict);
  assert.equal(writes.length, 0);
});

test('沒有加好友禮時可以建立', async () => {
  const { db, writes } = fakeDb([]);
  await createRule(createMockTenantCtx(db, T).ctx, followGift());
  assert.equal(writes.length, 1);
});

test('加入好友規則只傳送訊息、不發券：不受限制', async () => {
  const { db, writes } = fakeDb([existingGift]);
  await createRule(createMockTenantCtx(db, T).ctx, followGift([{ type: 'send_message', params: { text: '歡迎' } }]));
  assert.equal(writes.length, 1);
});

test('已刪除的加好友禮不算', async () => {
  const { db, writes } = fakeDb([{ ...existingGift, enabled: false }]);
  await createRule(createMockTenantCtx(db, T).ctx, followGift());
  assert.equal(writes.length, 1);
});

test('修改加好友禮本身（換券、改條件）不算重複', async () => {
  const { db, writes } = fakeDb([existingGift]);
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { actions: [{ type: 'issue_coupon', params: { couponId: COUPON } }] });
  assert.equal(writes.length, 1);
});

test('把另一條加入好友規則改成發券：已有加好友禮時回 409', async () => {
  const other: Rule = { ...existingGift, id: 'r2', actions: [{ type: 'send_message', params: { text: '歡迎' } }] };
  const { db, writes } = fakeDb([existingGift, other]);
  await assert.rejects(
    updateRule(createMockTenantCtx(db, T).ctx, 'r2', { actions: [{ type: 'issue_coupon', params: { couponId: COUPON } }] }),
    isConflict,
  );
  assert.equal(writes.length, 0);
});

test('其他租戶的加好友禮不影響', async () => {
  const { db, writes } = fakeDb([{ ...existingGift, tenantId: 'tenant-b' }]);
  await createRule(createMockTenantCtx(db, T).ctx, followGift());
  assert.equal(writes.length, 1);
});
