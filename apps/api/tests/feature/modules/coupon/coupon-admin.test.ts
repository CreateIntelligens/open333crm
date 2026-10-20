/**
 * 優惠券後台第一階段（add-coupon-system A8）的行為測試。
 *
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線。
 * 本檔建立的券以 createdById 標記、聯絡人與標籤以 MARK 前綴標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '#src/lib/tenant-db.js';
import {
  createCoupon,
  updateCoupon,
  getCoupon,
  listCoupons,
  duplicateCoupon,
  deleteCoupon,
  CouponValidationError,
  CouponLockedError,
  CouponConflictError,
  type CouponInput,
} from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { listInstances } from '#src/modules/coupon/coupon-stats.service.js';

const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const tenantId = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const otherTenantId = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `coupon-admin-${Date.now()}`;
const agentId = randomUUID();

const inTenant = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) =>
  withTenant(prisma, tenantId, fn);

/** 可直接發布的完整設定 */
const PUBLISHABLE: CouponInput = {
  couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, minSpend: 1000, purpose: 'MARKETING',
  validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
  codeMode: 'UNIQUE_CODE', codePrefix: 'ADM', redeemMode: 'STAFF_CODE', staffCode: '582917',
  perContactLimit: 5,
};

async function draft(name: string, input: CouponInput = {}) {
  return inTenant((tx) => createCoupon(tx, tenantId, agentId, { name: `${MARK} ${name}`, ...input }));
}

async function published(name: string, input: CouponInput = {}) {
  const c = await draft(name, { ...PUBLISHABLE, ...input });
  const r = await inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE'));
  assert.ok(r.ok, `發布失敗：${JSON.stringify(r)}`);
  return c;
}

async function newContact(label: string) {
  return (await owner.contact.create({ data: { tenantId, displayName: `${MARK}-${label}` } })).id;
}

/** 直接寫入指定狀態的券（測列表計數與明細篩選用，不走發券流程） */
async function seedInstance(couponId: string, code: string, status: string, extra: Record<string, unknown> = {}) {
  const claimed = status !== 'ISSUED';
  return owner.couponInstance.create({
    data: {
      tenantId, couponId, code, status: status as never,
      claimedAt: claimed ? new Date() : null,
      redeemedAt: status === 'REDEEMED' ? new Date() : null,
      ...extra,
    },
  });
}

beforeAll(async () => {
  // 讓 fixture 租戶有一個屬於本檔的座席 id 可記錄，不需要真的座席資料列
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] }, createdById: agentId } });
  const contacts = { tenantId, displayName: { startsWith: MARK } };
  await owner.contactTag.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.tag.deleteMany({ where: { tenantId, name: { startsWith: MARK } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('建立券時須指定券型、效期模式與序號模式', () => {
  it('草稿只填券名即可儲存', async () => {
    const c = await draft('只有名稱');
    assert.equal(c.status, 'DRAFT');
    assert.equal(c.couponType, null);

    await assert.rejects(
      () => inTenant((tx) => createCoupon(tx, tenantId, agentId, { name: '  ' })),
      (err: Error) => err instanceof CouponValidationError && err.message === '請先填寫優惠券名稱',
    );
  });

  it('發布時檢查全部必填', async () => {
    for (const missing of ['couponType', 'purpose', 'validityMode', 'codeMode', 'redeemMode'] as const) {
      const c = await draft(`缺 ${missing}`, { ...PUBLISHABLE, [missing]: null });
      await assert.rejects(
        () => inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE')),
        CouponValidationError,
        `缺 ${missing} 竟可發布`,
      );
      const after = await inTenant((tx) => getCoupon(tx, tenantId, c.id));
      assert.equal(after?.status, 'DRAFT');
    }
  });
});

describe('券型決定面額欄位', () => {
  it('元折抵的折抵金額須小於門檻', async () => {
    await assert.rejects(
      () => draft('折抵大於門檻', { couponType: 'DISCOUNT_AMOUNT', discountAmount: 500, minSpend: 300 }),
      (err: Error) => err instanceof CouponValidationError && err.message === '折抵金額需小於最低消費門檻 NT$300',
    );
    const ok = await draft('無門檻', { couponType: 'DISCOUNT_AMOUNT', discountAmount: 500, minSpend: 0 });
    assert.equal(ok.minSpend, 0);
  });

  it('百分比超出範圍', async () => {
    for (const pct of [0, 100]) {
      await assert.rejects(
        () => draft(`折扣 ${pct}`, { couponType: 'DISCOUNT_PERCENT', discountPercent: pct }),
        (err: Error) => err instanceof CouponValidationError && err.message === '折扣比例只能是 1–99',
      );
    }
  });

  it('贈品券缺少贈品名稱', async () => {
    const c = await draft('贈品缺名', { ...PUBLISHABLE, couponType: 'GIFT', discountAmount: null, minSpend: null });
    await assert.rejects(() => inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE')), /贈品名稱/);
  });

  it('兌換券缺少兌換品項', async () => {
    const c = await draft('兌換缺品項', { ...PUBLISHABLE, couponType: 'EXCHANGE', discountAmount: null, minSpend: null });
    await assert.rejects(() => inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE')), /兌換品項/);
  });
});

describe('店員驗證碼格式', () => {
  it('驗證碼位數或字元不符', async () => {
    await assert.rejects(
      () => draft('驗證碼過短', { redeemMode: 'STAFF_CODE', staffCode: '123' }),
      (err: Error) => err instanceof CouponValidationError && err.message === '需 4–6 位數字',
    );
  });

  it('驗證碼為連續或重複數字', async () => {
    await assert.rejects(
      () => draft('驗證碼連號', { redeemMode: 'STAFF_CODE', staffCode: '123456' }),
      (err: Error) => err instanceof CouponValidationError && err.message === '請避免使用連續或重複的數字',
    );
  });

  it('開頭為 0 的驗證碼完整保留', async () => {
    const c = await draft('開頭為零', { redeemMode: 'STAFF_CODE', staffCode: '082741' });
    const read = await inTenant((tx) => getCoupon(tx, tenantId, c.id));
    assert.equal(read?.staffCode, '082741');
  });
});

describe('發布後鎖定關鍵設定', () => {
  it('修改已發布券的鎖定欄位', async () => {
    const c = await published('鎖定');
    const cases: CouponInput[] = [
      { couponType: 'GIFT' }, { discountAmount: 200 }, { endAt: '2031-01-01' },
      { codeMode: 'SHARED_CODE' }, { redeemMode: 'SELF' }, { staffCode: '582918' },
    ];
    for (const input of cases) {
      await assert.rejects(
        () => inTenant((tx) => updateCoupon(tx, tenantId, c.id, input)),
        (err: Error) =>
          err instanceof CouponLockedError &&
          err.message === '優惠券發布後無法修改' &&
          err.fields.includes(Object.keys(input)[0]),
        `可以修改 ${Object.keys(input)[0]}`,
      );
    }
    const after = await inTenant((tx) => getCoupon(tx, tenantId, c.id));
    assert.equal(after?.discountAmount, 100);
    assert.equal(after?.staffCode, '582917');
  });

  it('修改已發布券的可改欄位', async () => {
    const c = await published('可改');
    const updated = await inTenant((tx) =>
      updateCoupon(tx, tenantId, c.id, { name: `${MARK} 可改（新名）`, perContactLimit: 2 }));
    assert.equal(updated?.name, `${MARK} 可改（新名）`);
    assert.equal(updated?.perContactLimit, 2);
  });

  it('草稿可修改所有欄位', async () => {
    const c = await draft('草稿可改', PUBLISHABLE);
    const updated = await inTenant((tx) =>
      updateCoupon(tx, tenantId, c.id, { couponType: 'GIFT', giftName: '蒸架', staffCode: '582918' }));
    assert.equal(updated?.couponType, 'GIFT');
    assert.equal(updated?.staffCode, '582918');
  });
});

describe('發行控制', () => {
  it('調低發行總量不可低於已發放張數', async () => {
    const c = await published('總量下限', { totalLimit: 200, perContactLimit: 1 });
    for (let i = 0; i < 3; i++) await seedInstance(c.id, `${MARK}-LIM-${i}`, 'CLAIMED');

    await assert.rejects(
      () => inTenant((tx) => updateCoupon(tx, tenantId, c.id, { totalLimit: 2 })),
      (err: Error) => err instanceof CouponValidationError && err.message === '不能低於已發放的 3 張',
    );
    const atIssued = await inTenant((tx) => updateCoupon(tx, tenantId, c.id, { totalLimit: 3 }));
    assert.equal(atIssued?.totalLimit, 3);
    const unlimited = await inTenant((tx) => updateCoupon(tx, tenantId, c.id, { totalLimit: null }));
    assert.equal(unlimited?.totalLimit, null);
  });

  it('每人上限不可大於發行總量', async () => {
    await assert.rejects(
      () => draft('每人大於總量', { perContactLimit: 5, totalLimit: 3 }),
      (err: Error) => err instanceof CouponValidationError && err.message === '每人領取上限不能大於發行總量（3 張）',
    );
  });
});

describe('共用碼不可與其他券重複', () => {
  const shared = `ADM${Date.now().toString(36).toUpperCase()}`.slice(0, 20);

  it('共用碼與其他券重複', async () => {
    const first = await draft('共用碼甲', { codeMode: 'SHARED_CODE', sharedCode: shared });
    await assert.rejects(
      () => draft('共用碼乙', { codeMode: 'SHARED_CODE', sharedCode: shared.toLowerCase() }),
      (err: Error) =>
        err instanceof CouponConflictError &&
        err.message === `與其他券重複（${first.name}），請換一組券號`,
    );
  });

  it('其他租戶使用相同共用碼', async () => {
    const c = await withTenant(prisma, otherTenantId, (tx) =>
      createCoupon(tx, otherTenantId, agentId, { name: `${MARK} 他租戶共用碼`, codeMode: 'SHARED_CODE', sharedCode: shared }));
    assert.equal(c.sharedCode, shared);
  });

  it('共用碼格式不符', async () => {
    for (const code of ['AB 1', 'ABC']) {
      await assert.rejects(
        () => draft(`共用碼 ${code}`, { codeMode: 'SHARED_CODE', sharedCode: code }),
        CouponValidationError,
      );
    }
  });
});

describe('每張券有可搜尋的券號', () => {
  it('建立券時產生券號', async () => {
    const a = await draft('券號甲');
    const b = await draft('券號乙');
    assert.match(a.displayCode, /^CP-[0-9A-Z]{6}$/);
    assert.notEqual(a.displayCode, b.displayCode);
    const updated = await inTenant((tx) => updateCoupon(tx, tenantId, a.id, { name: `${MARK} 券號甲改名` }));
    assert.equal(updated?.displayCode, a.displayCode);
  });
});

describe('後台券列表', () => {
  it('依券名或券號搜尋', async () => {
    const byName = await draft('維修延誤補償券');
    const byCode = await draft('以券號搜尋');
    const r1 = await inTenant((tx) => listCoupons(tx, tenantId, { q: '延誤補償' }));
    assert.ok(r1.items.some((c) => c.id === byName.id));
    const r2 = await inTenant((tx) => listCoupons(tx, tenantId, { q: byCode.displayCode.slice(0, 7).toLowerCase() }));
    assert.ok(r2.items.some((c) => c.id === byCode.id));
  });

  it('狀態計數不受狀態篩選影響', async () => {
    const all = await inTenant((tx) => listCoupons(tx, tenantId, { q: MARK }));
    const drafts = await inTenant((tx) => listCoupons(tx, tenantId, { q: MARK, status: 'DRAFT' }));
    assert.ok(drafts.items.every((c) => c.status === 'DRAFT'));
    assert.deepEqual(drafts.statusCounts, all.statusCounts);
    const c = all.statusCounts;
    assert.equal(c.ALL, c.ACTIVE + c.PAUSED + c.DRAFT + c.ENDED);
    assert.equal(drafts.total, c.DRAFT);
  });

  it('每列帶出發放與核銷張數', async () => {
    const c = await published('計數');
    await seedInstance(c.id, `${MARK}-CNT-1`, 'ISSUED');
    await seedInstance(c.id, `${MARK}-CNT-2`, 'CLAIMED');
    await seedInstance(c.id, `${MARK}-CNT-3`, 'REDEEMED');
    const r = await inTenant((tx) => listCoupons(tx, tenantId, { q: c.displayCode }));
    const row = r.items.find((x) => x.id === c.id);
    assert.equal(row?.issuedCount, 3);
    assert.equal(row?.claimedCount, 2);
    assert.equal(row?.redeemedCount, 1);
  });

  it('列表不含其他租戶的券', async () => {
    const other = await withTenant(prisma, otherTenantId, (tx) =>
      createCoupon(tx, otherTenantId, agentId, { name: `${MARK} 其他租戶的券` }));
    const r = await inTenant((tx) => listCoupons(tx, tenantId, { q: MARK }));
    assert.ok(!r.items.some((c) => c.id === other.id));
  });
});

describe('券的狀態流轉不可逆', () => {
  it('停用券使已發出的券失效', async () => {
    const c = await published('提前結束');
    const issued = await seedInstance(c.id, `${MARK}-END-1`, 'ISSUED');
    const claimed = await seedInstance(c.id, `${MARK}-END-2`, 'CLAIMED');
    const opened = await seedInstance(c.id, `${MARK}-END-3`, 'OPENED');
    const redeemed = await seedInstance(c.id, `${MARK}-END-4`, 'REDEEMED');

    const r = await inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ENDED'));
    assert.ok(r.ok);
    assert.equal(r.claimed, 3);
    assert.equal(r.unredeemed, 2);

    const statuses = await owner.couponInstance.findMany({
      where: { id: { in: [issued.id, claimed.id, opened.id, redeemed.id] } },
      select: { id: true, status: true },
    });
    const byId = new Map(statuses.map((s) => [s.id, s.status]));
    assert.equal(byId.get(issued.id), 'REVOKED');
    assert.equal(byId.get(claimed.id), 'REVOKED');
    assert.equal(byId.get(opened.id), 'REVOKED');
    assert.equal(byId.get(redeemed.id), 'REDEEMED');
  });

  it('暫停發放不影響已領取的券', async () => {
    const c = await published('暫停');
    const claimed = await seedInstance(c.id, `${MARK}-PAUSE-1`, 'CLAIMED');
    const r = await inTenant((tx) => changeStatus(tx, tenantId, c.id, 'PAUSED'));
    assert.ok(r.ok);
    const kept = await owner.couponInstance.findUnique({ where: { id: claimed.id } });
    assert.equal(kept?.status, 'CLAIMED');
    const contact = await newContact('暫停中發券');
    await assert.rejects(
      () => issueCoupons(prisma, tenantId, c.id, { contactIds: [contact], issuedVia: 'inbox' }),
      CouponValidationError,
    );
    const resumed = await inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE'));
    assert.ok(resumed.ok);
  });

  it('已結束的券不可恢復', async () => {
    const c = await published('不可恢復');
    await inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ENDED'));
    const r = await inTenant((tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE'));
    assert.equal(r.ok, false);
    const after = await inTenant((tx) => getCoupon(tx, tenantId, c.id));
    assert.equal(after?.status, 'ENDED');
  });
});

describe('券可複製為草稿', () => {
  it('複製進行中的券', async () => {
    const src = await published('秋季回饋');
    const copy = await inTenant((tx) => duplicateCoupon(tx, tenantId, src.id, agentId));
    assert.ok(copy);
    assert.equal(copy.status, 'DRAFT');
    assert.equal(copy.name, `${src.name}（複製）`);
    assert.equal(copy.couponType, src.couponType);
    assert.equal(copy.discountAmount, src.discountAmount);
    assert.equal(copy.staffCode, null);
    assert.equal(copy.sharedCode, null);
    assert.notEqual(copy.displayCode, src.displayCode);
    const original = await inTenant((tx) => getCoupon(tx, tenantId, src.id));
    assert.equal(original?.status, 'ACTIVE');
  });
});

describe('只有草稿可以刪除', () => {
  it('刪除草稿', async () => {
    const c = await draft('要刪的草稿');
    const r = await inTenant((tx) => deleteCoupon(tx, tenantId, c.id));
    assert.equal(r.deleted, true);
    assert.equal(await inTenant((tx) => getCoupon(tx, tenantId, c.id)), null);
  });

  it('刪除已發布的券', async () => {
    const c = await published('不可刪');
    const r = await inTenant((tx) => deleteCoupon(tx, tenantId, c.id));
    assert.equal(r.deleted, false);
    assert.equal(r.reason, 'NOT_DRAFT');
    assert.ok(await inTenant((tx) => getCoupon(tx, tenantId, c.id)));
  });
});

describe('序號明細查詢', () => {
  it('序號搜尋忽略連字號與大小寫', async () => {
    const c = await published('序號搜尋');
    const code = `Q${Date.now().toString(36).toUpperCase()}-XKM4-QDEJ`;
    await seedInstance(c.id, code, 'CLAIMED');
    await seedInstance(c.id, `${MARK}-OTHER`, 'CLAIMED');
    const r = await inTenant((tx) => listInstances(tx, tenantId, c.id, { q: code.replace(/-/g, '').toLowerCase() }));
    assert.equal(r.total, 1);
    assert.equal(r.items[0].code, code);
  });

  it('依狀態篩選', async () => {
    const c = await published('狀態篩選');
    await seedInstance(c.id, `${MARK}-ST-1`, 'REDEEMED');
    await seedInstance(c.id, `${MARK}-ST-2`, 'CLAIMED');
    await seedInstance(c.id, `${MARK}-ST-3`, 'CLAIMED');
    const r = await inTenant((tx) => listInstances(tx, tenantId, c.id, { status: 'REDEEMED' }));
    assert.equal(r.total, 1);
    assert.equal(r.items.length, 1);
  });

  it('每頁 50 筆', async () => {
    const c = await published('分頁', { totalLimit: null });
    await owner.couponInstance.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        tenantId, couponId: c.id, code: `${MARK}-PG-${i}`, status: 'CLAIMED' as const, claimedAt: new Date(),
      })),
    });
    const r = await inTenant((tx) => listInstances(tx, tenantId, c.id, { page: 3 }));
    assert.equal(r.total, 120);
    assert.equal(r.items.length, 20);
    assert.equal(r.limit, 50);
  });
});

describe('發放來源保存當下名稱', () => {
  it('對話發券記錄座席名稱', async () => {
    const c = await published('來源快照');
    const contact = await newContact('來源快照');
    const r = await issueCoupons(prisma, tenantId, c.id, {
      contactIds: [contact], issuedVia: 'inbox', issuedRefId: agentId, issuedByName: '王小美',
    });
    assert.equal(r.issued.length, 1);
    const page = await inTenant((tx) => listInstances(tx, tenantId, c.id, {}));
    const row = page.items.find((i) => i.id === r.issued[0].id);
    assert.equal(row?.issuedSourceName, '對話發券');
    assert.equal(row?.issuedByName, '王小美');
  });
});

describe('領券時自動貼標', () => {
  it('標籤依時效自動移除', async () => {
    const tag = await owner.tag.create({ data: { tenantId, name: `${MARK}-秋季檔期意向` } });
    const c = await published('貼標時效', { claimTagId: tag.id, claimTagTtlDays: 30 });
    const contact = await newContact('貼標時效');
    const before = Date.now();
    await issueCoupons(prisma, tenantId, c.id, { contactIds: [contact], issuedVia: 'inbox' });
    const ct = await owner.contactTag.findUnique({ where: { contactId_tagId: { contactId: contact, tagId: tag.id } } });
    assert.ok(ct?.expiresAt, '標籤沒有到期時間');
    const days = (ct.expiresAt.getTime() - before) / 86_400_000;
    assert.ok(days > 29.9 && days < 30.1, `到期時間不是 30 天後：${days}`);
  });
});
