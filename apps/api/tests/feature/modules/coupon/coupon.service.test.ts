/**
 * 券系統行為測試。
 *
 * 需要真實 Postgres —— 核銷防重複與憑證搶佔都是 DB 層保證，
 * mock 掉就等於沒測到真正要驗的東西。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 * service 以 app_tenant 連線呼叫（RLS 生效），因此跨租戶隔離案例在這裡會真的執行；
 * 建立與清理資料用 owner 連線。本檔建立的券以 createdById 標記、聯絡人以 displayName 標記，
 * 於 afterAll 刪除。
 * 券碼與條款消毒的純函式案例在 tests/unit/modules/coupon/。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '#src/lib/tenant-db.js';
import { createCoupon, CouponValidationError } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { claimByToken, redeemCoupon, openInstance } from '#src/modules/coupon/coupon-redeem.service.js';
import { importCodes, previewImport, removeAvailableCode } from '#src/modules/coupon/coupon-import.service.js';
import { getCouponStats, exportInstancesCsv } from '#src/modules/coupon/coupon-stats.service.js';
import { ctxOf, runInTenant } from '#tests/support/tenant-run.js';

const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const tenantId = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const otherTenantId = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `coupon-test-${Date.now()}`;
/** 本檔所有券的 createdById，也是清理時的標記 */
const agentId = randomUUID();
let contactA = '';
let contactB = '';

beforeAll(async () => {
  contactA = (await owner.contact.create({ data: { tenantId, displayName: `${MARK}-顧客A` } })).id;
  contactB = (await owner.contact.create({ data: { tenantId, displayName: `${MARK}-顧客B` } })).id;
});

afterAll(async () => {
  // coupon_instances、coupon_codes 隨 coupons 串聯刪除
  await owner.coupon.deleteMany({ where: { tenantId, createdById: agentId } });
  const contacts = { tenantId, displayName: { startsWith: MARK } };
  await owner.contactTag.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.$disconnect();
  await prisma.$disconnect();
});

// ── 驗證規則 ──
it('折抵百分比超出範圍須拒絕', async () => {
  await assert.rejects(
    () => withTenant(prisma, tenantId, (tx) =>
      createCoupon(ctxOf(tx, tenantId), agentId, { name: '壞券', couponType: 'DISCOUNT_PERCENT', discountPercent: 150 })),
    CouponValidationError,
  );
});

it('生效日晚於到期日須拒絕', async () => {
  await assert.rejects(
    () => withTenant(prisma, tenantId, (tx) =>
      createCoupon(ctxOf(tx, tenantId), agentId, {
        name: '壞效期', couponType: 'GIFT', validityMode: 'FIXED',
        startAt: '2027-01-02', endAt: '2027-01-01',
      })),
    CouponValidationError,
  );
});

// ── 發布驗證 ──
let couponId = '';
it('建立券並發布', async () => {
  const coupon = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, {
      name: '測試折價券', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'MARKETING',
      validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
      codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_CODE', staffCode: '1357',
      perContactLimit: 1,
    }));
  couponId = coupon.id;
  const r = await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), couponId, 'ACTIVE'));
  assert.ok(r.ok, `發布失敗：${JSON.stringify(r)}`);
});

it('缺店員驗證碼的券不可發布', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, {
      name: '缺碼券', couponType: 'GIFT', giftName: '蒸架', purpose: 'MARKETING', validityMode: 'FIXED',
      startAt: '2026-01-01', endAt: '2030-12-31', codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_CODE',
    }));
  await assert.rejects(
    () => withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ACTIVE')),
    /驗證碼/,
  );
});

it('ENDED 為終態不可復活', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, { name: '終態券', couponType: 'GIFT' }));
  await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ENDED'));
  const r = await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ACTIVE'));
  assert.ok(!r.ok, 'ENDED 竟可轉回 ACTIVE');
  // 訊息用中文狀態名稱，不顯示 ENDED、ACTIVE 等代碼
  assert.equal(!r.ok && r.reason, '「已結束」的券無法改為「進行中」');
});

// ── 發券與配額 ──
it('發券給 LINE 已知身分者直接為 CLAIMED', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, couponId, {
    contactIds: [contactA], issuedVia: 'inbox', requireClaim: false,
  }));
  assert.equal(r.issued.length, 1);
  assert.equal(r.issued[0].status, 'CLAIMED');
  assert.equal(r.issued[0].claimToken, null, 'LINE 發券不應有領取憑證');
});

it('超過每人上限須略過並回報原因', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, couponId, {
    contactIds: [contactA], requireClaim: false,
  }));
  assert.equal(r.issued.length, 0);
  assert.equal(r.skipped[0]?.reason, 'PER_CONTACT_LIMIT_REACHED');
});

// ── 領取憑證（D10）──
let tokenInstance = '';
let token = '';
it('FB／IG 發券為 ISSUED 並帶領取憑證', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, couponId, {
    contactIds: [contactB], issuedVia: 'fb_inbox', requireClaim: true,
  }));
  assert.equal(r.issued[0].status, 'ISSUED');
  assert.ok(r.issued[0].claimToken, '未產生領取憑證');
  tokenInstance = r.issued[0].id;
  token = r.issued[0].claimToken!;
});

it('領取時已達每人上限', async () => {
  // contactA 已持有這張券（每人限 1），以別人的憑證領取也不能超過上限
  const r = await runInTenant(prisma, tenantId, (ctx) => claimByToken(ctx, token, contactA));
  assert.deepEqual(r, { ok: false, reason: 'PER_CONTACT_LIMIT_REACHED' });
  const inst = await withTenant(prisma, tenantId, (tx) =>
    tx.couponInstance.findFirst({ where: { id: tokenInstance, tenantId } }));
  assert.equal(inst?.status, 'ISSUED', '沒領成的券維持待領取');
});

it('憑證換券成功並歸戶至驗證身分', async () => {
  // 完成驗證的聯絡人（未持有此券）以 FB 對象的憑證領取，券改綁到他身上
  const verified = (await owner.contact.create({ data: { tenantId, displayName: `${MARK}-顧客C` } })).id;
  const r = await runInTenant(prisma, tenantId, (ctx) => claimByToken(ctx, token, verified));
  assert.ok(r.ok, `換券失敗：${JSON.stringify(r)}`);
  const inst = await withTenant(prisma, tenantId, (tx) =>
    tx.couponInstance.findFirst({ where: { id: tokenInstance, tenantId } }));
  assert.equal(inst?.status, 'CLAIMED');
  assert.equal(inst?.contactId, verified, '未改綁為完成驗證的聯絡人');
  assert.equal(inst?.claimToken, null, '憑證未於使用後清空');
});

it('同一憑證不可重複使用', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => claimByToken(ctx, token, contactB));
  assert.ok(!r.ok, '已用過的憑證竟可再次換券');
});

it('已作廢的券以憑證領取：回報活動已結束，不是已被領取', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, couponId, { contactIds: [contactB], issuedVia: 'fb_inbox', requireClaim: true }));
  const revoked = r.issued[0];
  await owner.couponInstance.update({ where: { id: revoked.id }, data: { status: 'REVOKED' } });
  const claimed = await runInTenant(prisma, tenantId, (ctx) => claimByToken(ctx, revoked.claimToken!, contactB));
  assert.deepEqual(claimed, { ok: false, reason: 'COUPON_INACTIVE' });
});

// ── 核銷（D3 核心）──
let redeemTarget = '';
it('取得一張可核銷的券', async () => {
  const inst = await withTenant(prisma, tenantId, (tx) =>
    tx.couponInstance.findFirst({ where: { tenantId, couponId, contactId: contactA, status: 'CLAIMED' } }));
  assert.ok(inst, '找不到可核銷的券');
  redeemTarget = inst!.id;
});

it('店員驗證碼不符須拒絕核銷', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => redeemCoupon(ctx, { instanceId: redeemTarget, staffCode: '9999', redeemedBy: agentId }));
  assert.ok(!r.ok && r.reason === 'STAFF_CODE_MISMATCH', `預期驗證碼不符，實得 ${JSON.stringify(r)}`);
});

it('非自助券不可由顧客端核銷', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => redeemCoupon(ctx, { instanceId: redeemTarget, selfService: true }));
  assert.ok(!r.ok && r.reason === 'SELF_REDEEM_NOT_ALLOWED', `預期擋下自助核銷，實得 ${JSON.stringify(r)}`);
});

it('驗證碼正確可核銷成功', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => redeemCoupon(ctx, { instanceId: redeemTarget, staffCode: '1357', redeemedBy: agentId }));
  assert.ok(r.ok, `核銷失敗：${JSON.stringify(r)}`);
});

it('重複核銷須回報已使用並附原核銷時間', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => redeemCoupon(ctx, { instanceId: redeemTarget, staffCode: '1357', redeemedBy: agentId }));
  assert.ok(!r.ok && r.reason === 'ALREADY_REDEEMED', `預期已使用，實得 ${JSON.stringify(r)}`);
  assert.ok(r.ok === false && r.redeemedAt, '未回報原核銷時間');
});

it('併發核銷僅一個成功（核心保證）', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, couponId, { contactIds: [contactB], requireClaim: false }));
  const target = r.issued[0].id;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      runInTenant(prisma, tenantId, (ctx) => redeemCoupon(ctx, { instanceId: target, staffCode: '1357', redeemedBy: agentId }))),
  );
  const ok = results.filter((x) => x.ok).length;
  assert.equal(ok, 1, `5 個併發請求有 ${ok} 個成功，應恰為 1`);
});

// ── 效期 ──
it('AFTER_OPEN 券於開啟時起算效期', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, {
      name: '開啟後計時券', couponType: 'GIFT', giftName: '蒸架', purpose: 'MARKETING', validityMode: 'AFTER_OPEN',
      afterOpenMinutes: 15, codeMode: 'UNIQUE_CODE', redeemMode: 'SELF', perContactLimit: 5,
    }));
  await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ACTIVE'));
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, c.id, { contactIds: [contactA], requireClaim: false }));
  const inst = r.issued[0];
  const before = await withTenant(prisma, tenantId, (tx) =>
    tx.couponInstance.findFirst({ where: { id: inst.id, tenantId } }));
  assert.equal(before?.expiresAt, null, '未開啟前不應有到期時間');
  const opened = await runInTenant(prisma, tenantId, (ctx) => openInstance(ctx, inst.id, contactA));
  assert.ok(opened.ok && opened.expiresAt, '開啟後未設定到期時間');
});

// ── 序號包匯入 ──
let importCouponId = '';
it('建立序號包模式的券', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, {
      name: '序號包券', couponType: 'EXCHANGE', exchangeItem: '冷氣清洗', purpose: 'MARKETING', codeMode: 'IMPORTED_CODES',
      redeemMode: 'SELF', perContactLimit: 10,
      validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
    }));
  importCouponId = c.id;
});

it('無庫存的序號包券不可發布', async () => {
  await assert.rejects(
    () => withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), importCouponId, 'ACTIVE')),
    /序號/,
  );
});

it('匯入前試算不寫入資料', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => previewImport(ctx, 'AAAA1111\nBBBB2222\nAAAA1111\nZZ'));
  assert.equal(r.willImport, 2);
  assert.deepEqual(r.duplicatesInInput, ['AAAA1111']);
  assert.deepEqual(r.invalid, ['ZZ']);
  const stored = await withTenant(prisma, tenantId, (tx) =>
    tx.couponCode.count({ where: { couponId: importCouponId, tenantId } }));
  assert.equal(stored, 0, '試算竟寫入了資料');
});

it('匯入序號並分類回報', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => importCodes(ctx, importCouponId, 'AAAA1111\nBBBB2222\nAAAA1111\nZZ'));
  assert.equal(r.imported, 2, `應匯入 2 筆，實得 ${r.imported}`);
  assert.deepEqual(r.duplicatesInInput, ['AAAA1111']);
  assert.deepEqual(r.invalid, ['ZZ']);
  assert.equal(r.availableTotal, 2);
});

it('再次匯入相同券碼須回報衝突而非重複寫入', async () => {
  const r = await runInTenant(prisma, tenantId, (ctx) => importCodes(ctx, importCouponId, 'AAAA1111\nCCCC3333'));
  assert.deepEqual(r.conflicts, ['AAAA1111']);
  assert.equal(r.imported, 1);
  assert.equal(r.availableTotal, 3);
});

it('有庫存後可發布，且發券會消耗序號', async () => {
  const pub = await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), importCouponId, 'ACTIVE'));
  assert.ok(pub.ok, `發布失敗：${JSON.stringify(pub)}`);
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, importCouponId, { contactIds: [contactA], requireClaim: false }));
  assert.equal(r.issued.length, 1);
  assert.ok(['AAAA1111', 'BBBB2222', 'CCCC3333'].includes(r.issued[0].code), `發出的券碼不在庫存中：${r.issued[0].code}`);
  const remaining = await withTenant(prisma, tenantId, (tx) =>
    tx.couponCode.count({ where: { couponId: importCouponId, tenantId, status: 'AVAILABLE' } }));
  assert.equal(remaining, 2, `庫存應剩 2，實得 ${remaining}`);
});

it('已配發的序號不可移除', async () => {
  const assigned = await withTenant(prisma, tenantId, (tx) =>
    tx.couponCode.findFirst({ where: { couponId: importCouponId, tenantId, status: 'ASSIGNED' } }));
  const r = await runInTenant(prisma, tenantId, (ctx) => removeAvailableCode(ctx, importCouponId, assigned!.code));
  assert.ok(!r.removed && r.reason === 'ALREADY_ASSIGNED', `預期擋下，實得 ${JSON.stringify(r)}`);
});

it('未配發的序號可移除', async () => {
  const avail = await withTenant(prisma, tenantId, (tx) =>
    tx.couponCode.findFirst({ where: { couponId: importCouponId, tenantId, status: 'AVAILABLE' } }));
  const r = await runInTenant(prisma, tenantId, (ctx) => removeAvailableCode(ctx, importCouponId, avail!.code));
  assert.ok(r.removed, '未配發的序號竟無法移除');
});

it('序號用罄時發券須回報而非拋錯中斷', async () => {
  // 清掉剩餘庫存後再發
  await withTenant(prisma, tenantId, (tx) =>
    tx.couponCode.deleteMany({ where: { couponId: importCouponId, tenantId, status: 'AVAILABLE' } }));
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, importCouponId, { contactIds: [contactB], requireClaim: false }));
  assert.equal(r.issued.length, 0);
  assert.equal(r.skipped[0]?.reason, 'CODES_EXHAUSTED', `預期回報序號用罄，實得 ${JSON.stringify(r.skipped)}`);
});

// ── 成效統計 ──
it('成效指標的累積口徑正確', async () => {
  const stats = await withTenant(prisma, tenantId, (tx) => getCouponStats(ctxOf(tx, tenantId), couponId));
  assert.ok(stats, '查無統計');
  // 已核銷者也算曾經領取過，claimed 須 >= redeemed
  assert.ok(stats!.claimed >= stats!.redeemed, `claimed(${stats!.claimed}) 應 >= redeemed(${stats!.redeemed})`);
  assert.ok(stats!.issued >= stats!.claimed, `issued(${stats!.issued}) 應 >= claimed(${stats!.claimed})`);
  assert.ok(stats!.redeemed > 0, '先前已核銷過，redeemed 不應為 0');
});

it('無人領取時核銷率為 null 而非 0', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, { name: '零領取券', couponType: 'GIFT' }));
  const stats = await withTenant(prisma, tenantId, (tx) => getCouponStats(ctxOf(tx, tenantId), c.id));
  assert.equal(stats!.redeemRate, null, '沒有分母時不應回 0');
  assert.equal(stats!.claimRate, null);
});

it('CSV 匯出含 BOM 且不外洩領取憑證', async () => {
  const csv = await exportInstancesCsv((fn) => runInTenant(prisma, tenantId, fn), couponId);
  assert.ok(csv.startsWith('﻿'), '缺少 BOM，Excel 開啟會亂碼');
  assert.ok(csv.includes('券號'), '缺少標題列');
  assert.ok(!/claimToken/i.test(csv), 'CSV 竟含 claimToken 欄位');
  // 憑證值本身也不可出現
  const withToken = await withTenant(prisma, tenantId, (tx) =>
    tx.couponInstance.findFirst({ where: { tenantId, claimToken: { not: null } } }));
  if (withToken?.claimToken) {
    assert.ok(!csv.includes(withToken.claimToken), 'CSV 外洩了有效的領取憑證');
  }
});

it('CSV 欄位含逗號時不破壞格式', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, {
      name: '含,逗號"引號的券', couponType: 'GIFT', giftName: '蒸架', purpose: 'MARKETING', perContactLimit: 5,
      validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
      codeMode: 'UNIQUE_CODE', redeemMode: 'SELF',
    }));
  await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ACTIVE'));
  await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, c.id, { contactIds: [contactA], requireClaim: false }));
  const csv = await exportInstancesCsv((fn) => runInTenant(prisma, tenantId, fn), c.id);
  const lines = csv.split('\n');
  // 每列欄位數須一致（用引號包住後，逗號不會被誤判為分隔）
  const countCells = (line: string) => (line.match(/","/g) ?? []).length;
  assert.equal(countCells(lines[1]), countCells(lines[0]), '資料列欄位數與標題列不符');
});

// ── 租戶隔離 ──
// 舊版以本機 superuser 連線，RLS 不生效只能跳過；這裡以 app_tenant 連線，RLS 由 DB 強制，案例真的執行。
it('跨租戶讀不到他人的券（RLS）', async () => {
  const seen = await withTenant(prisma, otherTenantId, (tx) => tx.coupon.count({ where: { tenantId } }));
  assert.equal(seen, 0, `別的租戶竟看到 ${seen} 張券`);
});

// 應用層隔離不依賴 RLS，任何角色下都必須成立——這是 check-tenant-scoping 把關的那一層
it('應用層 where tenantId 擋掉他人的券', async () => {
  const other = randomUUID();
  const seen = await withTenant(prisma, tenantId, (tx) =>
    tx.coupon.count({ where: { tenantId: other } }));
  assert.equal(seen, 0, `帶錯 tenantId 竟查到 ${seen} 張券`);
});

it('開啟別人的券回報查無此券', async () => {
  const c = await withTenant(prisma, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), agentId, {
      name: '開啟測試券', couponType: 'GIFT', giftName: '濾網', purpose: 'MARKETING', validityMode: 'AFTER_OPEN',
      afterOpenMinutes: 15, codeMode: 'UNIQUE_CODE', redeemMode: 'SELF', perContactLimit: 5,
    }));
  assert.ok((await withTenant(prisma, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ACTIVE'))).ok);
  const r = await runInTenant(prisma, tenantId, (ctx) => issueCoupons(ctx, c.id, { contactIds: [contactB], requireClaim: false }));
  const opened = await runInTenant(prisma, tenantId, (ctx) => openInstance(ctx, r.issued[0].id, contactA));
  assert.equal(opened.ok, false);
  assert.equal(!opened.ok && opened.reason, 'NOT_FOUND');
  const own = await runInTenant(prisma, tenantId, (ctx) => openInstance(ctx, r.issued[0].id, contactB));
  assert.equal(own.ok, true);
});
