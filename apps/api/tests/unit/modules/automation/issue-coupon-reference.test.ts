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
/** 固定效期已過到期日、狀態仍是進行中 */
const COUPON_EXPIRED = '55555555-5555-4555-8555-555555555555';

const coupons: Array<{ id: string; tenantId: string; status: string; validityMode?: string; endAt?: Date }> = [
  { id: COUPON_OK, tenantId: T, status: 'ACTIVE' },
  { id: COUPON_EXPIRED, tenantId: T, status: 'ACTIVE', validityMode: 'FIXED', endAt: new Date('2026-01-01T00:00:00Z') },
  { id: COUPON_PAUSED, tenantId: T, status: 'PAUSED' },
  { id: COUPON_OTHER_TENANT, tenantId: 'tenant-b', status: 'ACTIVE' },
];

/** 模擬 Prisma 的 couponNotPastFixedEnd 條件（OR 明列可用情況） */
function notPastFixedEnd(c: { validityMode?: string | null; endAt?: Date | null }, or: Array<Record<string, any>> | undefined) {
  if (!or) return true;
  const mode = c.validityMode ?? null;
  const end = c.endAt ?? null;
  return or.some((k) =>
    ('validityMode' in k && k.validityMode === null && mode === null)
    || (k.validityMode?.in && mode !== null && k.validityMode.in.includes(mode))
    || ('endAt' in k && k.endAt === null && end === null)
    || (k.endAt?.gt && end !== null && end > k.endAt.gt));
}

function fakeDb(existingCouponId = COUPON_PAUSED) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    coupon: {
      async findMany({ where }: { where: { tenantId: string; status?: string; id: { in: string[] }; OR?: Array<Record<string, any>> } }) {
        return coupons
          .filter((c) => c.tenantId === where.tenantId && where.id.in.includes(c.id))
          .filter((c) => where.status === undefined || c.status === where.status)
          .filter((c) => notPastFixedEnd(c, where.OR))
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
        actions: [{ type: 'issue_coupon', params: { couponId: existingCouponId } }],
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
  ['固定效期已過到期日', COUPON_EXPIRED],
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

// ── 券沒有更換就不檢查（2026-10-22 審查決定）：券被暫停後，商家仍要能改關鍵字或素材 ──

test('規則上的券已暫停，只修改關鍵字可以存檔', async () => {
  const { db, writes } = fakeDb(COUPON_PAUSED);
  await updateRule(db, 'r1', T, {
    trigger: { type: 'keyword.matched', keywords: ['領券', '優惠'], match_mode: 'any' },
    actions: [{ type: 'issue_coupon', params: { couponId: COUPON_PAUSED, failureText: '您已經領過這張券囉' } }],
  });
  assert.equal(writes.length, 1);
});

test('更換成暫停的券會被擋', async () => {
  const { db, writes } = fakeDb(COUPON_OK);
  await assert.rejects(updateRule(db, 'r1', T, { actions: rule(COUPON_PAUSED).actions }), is400);
  assert.equal(writes.length, 0);
});

test('更換成其他租戶的券會被擋', async () => {
  const { db } = fakeDb(COUPON_PAUSED);
  await assert.rejects(updateRule(db, 'r1', T, { actions: rule(COUPON_OTHER_TENANT).actions }), is400);
});

test('新增第二個發券動作指向暫停的券會被擋', async () => {
  const { db } = fakeDb(COUPON_OK);
  await assert.rejects(
    updateRule(db, 'r1', T, { actions: [...rule(COUPON_OK).actions, ...rule(COUPON_PAUSED).actions] }),
    is400,
  );
});
