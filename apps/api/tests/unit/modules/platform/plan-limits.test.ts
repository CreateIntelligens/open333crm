/** 有效上限解析（主規格 plan-limits-core「有效上限解析」） */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { getEffectiveLimit, LIMIT_KEYS, resolveEffectiveLimit } from '#src/modules/platform/plan-limits.service.js';

test('覆寫優先：方案 maxAgents=3、租戶覆寫 5，有效上限是 5', () => {
  const tenant = { limitOverrides: { maxAgents: 5 }, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxAgents'), 5);
});

test('沒有覆寫時採用方案的值：limitOverrides 沒有 maxAgents，有效上限是方案的 3', () => {
  const tenant = { limitOverrides: { maxChannels: 1 }, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxAgents'), 3);
});

test('無 plan 無上限：租戶沒有方案時，每個上限都是 null', () => {
  const tenant = { limitOverrides: {}, plan: null };
  for (const key of ['maxAgents', 'maxTags', 'monthlyTokens', 'maxChannels'] as const) {
    assert.equal(resolveEffectiveLimit(tenant, key), null, key);
  }
});

test('覆寫成 null 時沒有上限：不採用方案的 3', () => {
  const tenant = { limitOverrides: { maxAgents: null }, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxAgents'), null);
});

test('方案沒有設定這個上限：方案的 limits 沒有 maxChannels，結果是無上限', () => {
  const tenant = { limitOverrides: {}, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxChannels'), null);
});

// ── 留言自動私訊的上限鍵（add-comment-keyword-private-reply design D23、「上限檢查點」） ──

test('上限鍵清單含留言自動私訊的 maxCommentReplyRules、monthlyCommentReplies', () => {
  assert.ok(LIMIT_KEYS.includes('maxCommentReplyRules'));
  assert.ok(LIMIT_KEYS.includes('monthlyCommentReplies'));
});

for (const key of ['maxCommentReplyRules', 'monthlyCommentReplies'] as const) {
  test(`${key}：租戶覆寫優先於方案`, () => {
    const tenant = { limitOverrides: { [key]: 20 }, plan: { limits: { [key]: 10 } } };
    assert.equal(resolveEffectiveLimit(tenant, key), 20);
  });

  test(`${key}：沒有覆寫時採用方案的值`, () => {
    const tenant = { limitOverrides: {}, plan: { limits: { [key]: 10 } } };
    assert.equal(resolveEffectiveLimit(tenant, key), 10);
  });

  test(`${key}：覆寫成 null 時無上限`, () => {
    const tenant = { limitOverrides: { [key]: null }, plan: { limits: { [key]: 10 } } };
    assert.equal(resolveEffectiveLimit(tenant, key), null);
  });

  test(`${key}：方案沒有這個鍵（既有方案）時無上限`, () => {
    const tenant = { limitOverrides: {}, plan: { limits: { maxAgents: 3 } } };
    assert.equal(resolveEffectiveLimit(tenant, key), null);
  });

  test(`${key}：不加 AI 加購量`, () => {
    const tenant = { limitOverrides: {}, plan: { limits: { [key]: 10 } } };
    assert.equal(resolveEffectiveLimit(tenant, key, 5000), 10);
  });
}

// ── AI 月額度含當月加購量（主規格 plan-limits-core「AI 月額度含當月加購量」） ──

interface TopupRow {
  tenantId: string;
  type: string;
  status: string;
  topupTokens: number | null;
  reviewedAt: Date | null;
}

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';

/** 台灣時間 → UTC Date */
const tpe = (iso: string) => new Date(Date.parse(`${iso}+08:00`));

/**
 * 只實作 getEffectiveLimit 用到的方法。planChangeRequest.aggregate 依 where 篩選，
 * 用來驗證服務傳出的條件（租戶、類型、狀態、核准時間區間）。
 */
function topupDb(limits: Record<string, number | null>, overrides: Record<string, number | null>, rows: TopupRow[]) {
  const inRange = (at: Date | null, range: { gte?: Date; lt?: Date } | undefined) =>
    at !== null && (!range?.gte || at >= range.gte) && (!range?.lt || at < range.lt);
  return {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === TENANT ? { limitOverrides: overrides, plan: { limits } } : null,
    },
    planChangeRequest: {
      aggregate: async ({ where }: {
        where: { tenantId: string; type: string; status: string; reviewedAt?: { gte?: Date; lt?: Date } };
      }) => {
        const sum = rows
          .filter((r) => r.tenantId === where.tenantId && r.type === where.type && r.status === where.status
            && inRange(r.reviewedAt, where.reviewedAt))
          .reduce((acc, r) => acc + (r.topupTokens ?? 0), 0);
        return { _sum: { topupTokens: sum === 0 ? null : sum } };
      },
    },
  } as never;
}

const approved = (tokens: number, reviewedAt: Date, tenantId = TENANT): TopupRow => ({
  tenantId, type: 'token_topup', status: 'approved', topupTokens: tokens, reviewedAt,
});

afterEach(() => {
  vi.useRealTimers();
});

test('同月多筆加購加總：方案 1,000,000，11 月核准 200,000 與 300,000，11/20 的有效上限是 1,500,000', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-11-20T12:00:00') });
  const db = topupDb({ monthlyTokens: 1_000_000 }, {}, [
    approved(200_000, tpe('2026-11-02T10:00:00')),
    approved(300_000, tpe('2026-11-15T10:00:00')),
  ]);
  assert.equal(await getEffectiveLimit(db, TENANT, 'monthlyTokens'), 1_500_000);
});

test('下個月回到方案額度：11/10 核准加購 500,000，台灣 12/01 00:00 的有效上限是 1,000,000', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-12-01T00:00:00') });
  const db = topupDb({ monthlyTokens: 1_000_000 }, {}, [approved(500_000, tpe('2026-11-10T10:00:00'))]);
  assert.equal(await getEffectiveLimit(db, TENANT, 'monthlyTokens'), 1_000_000);
});

test('台灣月初凌晨核准的加購算在新月份：12/01 00:30 核准，11/30 23:00 是 1,000,000、12/01 01:00 是 1,500,000', async () => {
  const db = topupDb({ monthlyTokens: 1_000_000 }, {}, [approved(500_000, tpe('2026-12-01T00:30:00'))]);
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-11-30T23:00:00') });
  assert.equal(await getEffectiveLimit(db, TENANT, 'monthlyTokens'), 1_000_000);
  vi.setSystemTime(tpe('2026-12-01T01:00:00'));
  assert.equal(await getEffectiveLimit(db, TENANT, 'monthlyTokens'), 1_500_000);
});

test('待審、駁回與其他租戶的加購不計入：有效上限仍是方案的 1,000,000', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-11-20T12:00:00') });
  const db = topupDb({ monthlyTokens: 1_000_000 }, {}, [
    { tenantId: TENANT, type: 'token_topup', status: 'pending', topupTokens: 100_000, reviewedAt: null },
    { tenantId: TENANT, type: 'token_topup', status: 'rejected', topupTokens: 200_000, reviewedAt: tpe('2026-11-05T10:00:00') },
    approved(400_000, tpe('2026-11-05T10:00:00'), OTHER),
  ]);
  assert.equal(await getEffectiveLimit(db, TENANT, 'monthlyTokens'), 1_000_000);
});

test('升級方案後加購加在新方案的額度上：light 時加購 50,000，升級到 standard 3,000,000 後是 3,050,000', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-11-20T12:00:00') });
  const rows = [approved(50_000, tpe('2026-11-03T10:00:00'))];
  assert.equal(await getEffectiveLimit(topupDb({ monthlyTokens: 1_500_000 }, {}, rows), TENANT, 'monthlyTokens'), 1_550_000);
  assert.equal(await getEffectiveLimit(topupDb({ monthlyTokens: 3_000_000 }, {}, rows), TENANT, 'monthlyTokens'), 3_050_000);
});

test('基礎上限無上限時仍無上限：本月已核准加購 500,000，方案的 monthlyTokens 是 null', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-11-20T12:00:00') });
  const db = topupDb({ monthlyTokens: null }, {}, [approved(500_000, tpe('2026-11-03T10:00:00'))]);
  assert.equal(await getEffectiveLimit(db, TENANT, 'monthlyTokens'), null);
});

test('加購量不影響其他上限：本月已核准加購 500,000，maxAgents 仍是方案的 3', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tpe('2026-11-20T12:00:00') });
  const db = topupDb({ maxAgents: 3 }, {}, [approved(500_000, tpe('2026-11-03T10:00:00'))]);
  assert.equal(await getEffectiveLimit(db, TENANT, 'maxAgents'), 3);
});
