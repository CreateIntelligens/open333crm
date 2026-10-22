/**
 * 自動化規則的「發送優惠券」動作要指向同租戶、進行中的券（add-coupon-system A15 15.2、design D25；
 * spec coupon-management「發券規則的優惠券須為進行中」）。比照 send-material-reference.test.ts。
 *
 * 原本 couponId 是文字框，存檔不檢查：貼錯的 UUID 或其他租戶的券都能存，規則觸發時才默默發不出去。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRule, updateRule } from '#src/modules/automation/automation.service.js';

const T = 'tenant-a';
const COUPON_OK = '11111111-1111-4111-8111-111111111111';
const COUPON_PAUSED = '22222222-2222-4222-8222-222222222222';
const COUPON_OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const COUPON_MISSING = '44444444-4444-4444-8444-444444444444';

const coupons = [
  { id: COUPON_OK, tenantId: T, status: 'ACTIVE' },
  { id: COUPON_PAUSED, tenantId: T, status: 'PAUSED' },
  { id: COUPON_OTHER_TENANT, tenantId: 'tenant-b', status: 'ACTIVE' },
];

function fakeDb() {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    coupon: {
      async findMany({ where }: { where: { tenantId: string; status?: string; id: { in: string[] } } }) {
        return coupons
          .filter((c) => c.tenantId === where.tenantId && where.id.in.includes(c.id))
          .filter((c) => where.status === undefined || c.status === where.status)
          .map((c) => ({ id: c.id }));
      },
    },
    automationRule: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'r1', ...data };
      },
      findFirst: async () => ({
        id: 'r1',
        tenantId: T,
        enabled: true,
        eventType: 'keyword.matched',
        trigger: { type: 'keyword.matched', keywords: ['領券'], match_mode: 'any' },
        conditions: { all: [] },
        actions: [{ type: 'issue_coupon', params: { couponId: COUPON_PAUSED } }],
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'r1', ...data };
      },
    },
  };
  return { db: db as never, writes };
}

const rule = (couponId: unknown) => ({
  name: '秋季領券',
  trigger: { type: 'keyword.matched', keywords: ['領券'], match_mode: 'any' },
  conditions: { all: [] },
  actions: [{ type: 'issue_coupon', params: { couponId } }],
});

const is400 = (e: { statusCode?: number; message?: string }) =>
  e.statusCode === 400 && /找不到可發放的優惠券/.test(e.message ?? '');

for (const [label, couponId] of [
  ['不是 UUID', 'not-a-uuid'],
  ['不存在', COUPON_MISSING],
  ['屬於其他租戶', COUPON_OTHER_TENANT],
  ['不是進行中', COUPON_PAUSED],
] as const) {
  test(`存檔時券不存在或屬於其他租戶（${label}）：回 400，不儲存規則`, async () => {
    const { db, writes } = fakeDb();
    await assert.rejects(createRule(db, T, rule(couponId)), is400);
    assert.equal(writes.length, 0);
  });
}

test('進行中的券：建立成功', async () => {
  const { db, writes } = fakeDb();
  await createRule(db, T, rule(COUPON_OK));
  assert.equal(writes.length, 1);
});

test('更新動作時同樣檢查', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(updateRule(db, 'r1', T, { actions: rule(COUPON_MISSING).actions }), is400);
  assert.equal(writes.length, 0);
});

test('沒有送 actions 時不檢查：既有規則的券已暫停，仍可停用或改名', async () => {
  const { db, writes } = fakeDb();
  await updateRule(db, 'r1', T, { name: '改名' });
  await updateRule(db, 'r1', T, { isActive: false });
  assert.equal(writes.length, 2);
});
