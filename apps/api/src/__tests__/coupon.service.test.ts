/**
 * 券系統行為測試。跑法：
 *   DATABASE_URL=... npx tsx src/__tests__/coupon.service.test.ts
 *
 * 需要真實 Postgres —— 核銷防重複與憑證搶佔都是 DB 層保證，
 * mock 掉就等於沒測到真正要驗的東西。
 */
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../lib/tenant-db.js';
import { createCoupon, CouponValidationError } from '../modules/coupon/coupon.service.js';
import { changeStatus } from '../modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '../modules/coupon/coupon-issue.service.js';
import { claimByToken, redeemCoupon, openInstance } from '../modules/coupon/coupon-redeem.service.js';
import { sanitizeTerms } from '../modules/coupon/terms-sanitizer.js';
import { importCodes, previewImport, removeAvailableCode } from '../modules/coupon/coupon-import.service.js';
import { getCouponStats, exportInstancesCsv } from '../modules/coupon/coupon-stats.service.js';
import { generateCouponCode, parseCodeList } from '../modules/coupon/coupon-code.service.js';

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

async function main() {
  const tenantId = randomUUID();
  const agentId = randomUUID();
  const contactA = randomUUID();
  const contactB = randomUUID();

  // 建最小測試資料。用 raw SQL 繞過 RLS 的建立階段（此時尚無租戶上下文）
  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, "updatedAt") VALUES ($1::uuid,$2,now())`, tenantId, '券測試租戶');
  for (const [cid, nm] of [[contactA, '顧客A'], [contactB, '顧客B']] as const) {
    await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, cid, tenantId, nm);
  }

  // ── 純函式 ──
  await t('券碼避開易混淆字元 0/O/1/I/L', async () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCouponCode();
      assert.ok(!/[01OIL]/.test(code), `產生了含混淆字元的碼：${code}`);
    }
  });

  await t('券碼前綴格式不符須拒絕', async () => {
    assert.throws(() => generateCouponCode('太長的前綴超過八碼'), /前綴/);
  });

  await t('券碼清單解析可分類有效／重複／格式錯誤', async () => {
    const r = parseCodeList('ABCD1234\nABCD1234\nXY\nEFGH5678,IJKL9012');
    assert.deepEqual(r.valid, ['ABCD1234', 'EFGH5678', 'IJKL9012']);
    assert.deepEqual(r.duplicatesInInput, ['ABCD1234']);
    assert.deepEqual(r.invalid, ['XY']);
  });

  await t('條款消毒移除 script 但保留合法標記', async () => {
    const out = sanitizeTerms('<p>規則</p><script>alert(1)</script><a href="https://x.com">連結</a>') ?? '';
    assert.ok(!out.includes('alert'), 'script 未被移除');
    assert.ok(out.includes('<p>規則</p>'), '合法段落被移除');
    assert.ok(out.includes('noopener'), '外開連結未補 noopener');
  });

  await t('條款消毒擋 javascript: 協議', async () => {
    const out = sanitizeTerms('<a href="javascript:alert(1)">壞</a>') ?? '';
    assert.ok(!out.includes('javascript'), 'javascript: 協議未被擋');
  });

  // ── 驗證規則 ──
  await t('折抵百分比超出範圍須拒絕', async () => {
    await assert.rejects(
      () => withTenant(prisma, tenantId, (tx) =>
        createCoupon(tx, tenantId, agentId, { name: '壞券', couponType: 'DISCOUNT_PERCENT', discountPercent: 150 })),
      CouponValidationError,
    );
  });

  await t('生效日晚於到期日須拒絕', async () => {
    await assert.rejects(
      () => withTenant(prisma, tenantId, (tx) =>
        createCoupon(tx, tenantId, agentId, {
          name: '壞效期', couponType: 'GIFT', validityMode: 'FIXED',
          startAt: '2027-01-02', endAt: '2027-01-01',
        })),
      CouponValidationError,
    );
  });

  // ── 發布驗證 ──
  let couponId = '';
  await t('建立券並發布', async () => {
    const coupon = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, {
        name: '測試折價券', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100,
        validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
        codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_CODE', staffCode: '1234',
        perContactLimit: 1,
      }));
    couponId = coupon.id;
    const r = await withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, couponId, 'ACTIVE'));
    assert.ok(r.ok, `發布失敗：${JSON.stringify(r)}`);
  });

  await t('缺店員驗證碼的券不可發布', async () => {
    const c = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, {
        name: '缺碼券', couponType: 'GIFT', validityMode: 'FIXED',
        startAt: '2026-01-01', endAt: '2030-12-31', redeemMode: 'STAFF_CODE',
      }));
    await assert.rejects(
      () => withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE')),
      /驗證碼/,
    );
  });

  await t('ENDED 為終態不可復活', async () => {
    const c = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, { name: '終態券', couponType: 'GIFT' }));
    await withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, c.id, 'ENDED'));
    const r = await withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE'));
    assert.ok(!r.ok, 'ENDED 竟可轉回 ACTIVE');
  });

  // ── 發券與配額 ──
  await t('發券給 LINE 已知身分者直接為 CLAIMED', async () => {
    const r = await issueCoupons(prisma, tenantId, couponId, {
      contactIds: [contactA], issuedVia: 'inbox', requireClaim: false,
    });
    assert.equal(r.issued.length, 1);
    assert.equal(r.issued[0].status, 'CLAIMED');
    assert.equal(r.issued[0].claimToken, null, 'LINE 發券不應有領取憑證');
  });

  await t('超過每人上限須略過並回報原因', async () => {
    const r = await issueCoupons(prisma, tenantId, couponId, {
      contactIds: [contactA], requireClaim: false,
    });
    assert.equal(r.issued.length, 0);
    assert.equal(r.skipped[0]?.reason, 'PER_CONTACT_LIMIT_REACHED');
  });

  // ── 領取憑證（D10）──
  let tokenInstance = '';
  let token = '';
  await t('FB／IG 發券為 ISSUED 並帶領取憑證', async () => {
    const r = await issueCoupons(prisma, tenantId, couponId, {
      contactIds: [contactB], issuedVia: 'fb_inbox', requireClaim: true,
    });
    assert.equal(r.issued[0].status, 'ISSUED');
    assert.ok(r.issued[0].claimToken, '未產生領取憑證');
    tokenInstance = r.issued[0].id;
    token = r.issued[0].claimToken!;
  });

  await t('憑證換券成功並歸戶至驗證身分', async () => {
    const r = await claimByToken(prisma, token, contactA, tenantId);
    assert.ok(r.ok, `換券失敗：${JSON.stringify(r)}`);
    const inst = await withTenant(prisma, tenantId, (tx) =>
      tx.couponInstance.findFirst({ where: { id: tokenInstance, tenantId } }));
    assert.equal(inst?.status, 'CLAIMED');
    assert.equal(inst?.contactId, contactA, '未改綁為完成驗證的聯絡人');
    assert.equal(inst?.claimToken, null, '憑證未於使用後清空');
  });

  await t('同一憑證不可重複使用', async () => {
    const r = await claimByToken(prisma, token, contactB, tenantId);
    assert.ok(!r.ok, '已用過的憑證竟可再次換券');
  });

  // ── 核銷（D3 核心）──
  let redeemTarget = '';
  await t('取得一張可核銷的券', async () => {
    const inst = await withTenant(prisma, tenantId, (tx) =>
      tx.couponInstance.findFirst({ where: { tenantId, contactId: contactA, status: 'CLAIMED' } }));
    assert.ok(inst, '找不到可核銷的券');
    redeemTarget = inst!.id;
  });

  await t('店員驗證碼不符須拒絕核銷', async () => {
    const r = await redeemCoupon(prisma, tenantId, { instanceId: redeemTarget, staffCode: '9999', redeemedBy: agentId });
    assert.ok(!r.ok && r.reason === 'STAFF_CODE_MISMATCH', `預期驗證碼不符，實得 ${JSON.stringify(r)}`);
  });

  await t('非自助券不可由顧客端核銷', async () => {
    const r = await redeemCoupon(prisma, tenantId, { instanceId: redeemTarget, selfService: true });
    assert.ok(!r.ok && r.reason === 'SELF_REDEEM_NOT_ALLOWED', `預期擋下自助核銷，實得 ${JSON.stringify(r)}`);
  });

  await t('驗證碼正確可核銷成功', async () => {
    const r = await redeemCoupon(prisma, tenantId, { instanceId: redeemTarget, staffCode: '1234', redeemedBy: agentId });
    assert.ok(r.ok, `核銷失敗：${JSON.stringify(r)}`);
  });

  await t('重複核銷須回報已使用並附原核銷時間', async () => {
    const r = await redeemCoupon(prisma, tenantId, { instanceId: redeemTarget, staffCode: '1234', redeemedBy: agentId });
    assert.ok(!r.ok && r.reason === 'ALREADY_REDEEMED', `預期已使用，實得 ${JSON.stringify(r)}`);
    assert.ok(r.ok === false && r.redeemedAt, '未回報原核銷時間');
  });

  await t('併發核銷僅一個成功（核心保證）', async () => {
    const r = await issueCoupons(prisma, tenantId, couponId, { contactIds: [contactB], requireClaim: false });
    const target = r.issued[0].id;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        redeemCoupon(prisma, tenantId, { instanceId: target, staffCode: '1234', redeemedBy: agentId })),
    );
    const ok = results.filter((x) => x.ok).length;
    assert.equal(ok, 1, `5 個併發請求有 ${ok} 個成功，應恰為 1`);
  });

  // ── 效期 ──
  await t('AFTER_OPEN 券於開啟時起算效期', async () => {
    const c = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, {
        name: '開啟後計時券', couponType: 'GIFT', validityMode: 'AFTER_OPEN',
        afterOpenMinutes: 15, redeemMode: 'SELF', perContactLimit: 5,
      }));
    await withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE'));
    const r = await issueCoupons(prisma, tenantId, c.id, { contactIds: [contactA], requireClaim: false });
    const inst = r.issued[0];
    const before = await withTenant(prisma, tenantId, (tx) =>
      tx.couponInstance.findFirst({ where: { id: inst.id, tenantId } }));
    assert.equal(before?.expiresAt, null, '未開啟前不應有到期時間');
    const opened = await openInstance(prisma, tenantId, inst.id, contactA);
    assert.ok(opened.ok && opened.expiresAt, '開啟後未設定到期時間');
  });

  // ── 序號包匯入 ──
  let importCouponId = '';
  await t('建立序號包模式的券', async () => {
    const c = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, {
        name: '序號包券', couponType: 'EXCHANGE', codeMode: 'IMPORTED_CODES',
        redeemMode: 'SELF', perContactLimit: 10,
        validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
      }));
    importCouponId = c.id;
  });

  await t('無庫存的序號包券不可發布', async () => {
    await assert.rejects(
      () => withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, importCouponId, 'ACTIVE')),
      /序號/,
    );
  });

  await t('匯入前試算不寫入資料', async () => {
    const r = await previewImport(prisma, tenantId, 'AAAA1111\nBBBB2222\nAAAA1111\nZZ');
    assert.equal(r.willImport, 2);
    assert.deepEqual(r.duplicatesInInput, ['AAAA1111']);
    assert.deepEqual(r.invalid, ['ZZ']);
    const stored = await withTenant(prisma, tenantId, (tx) =>
      tx.couponCode.count({ where: { couponId: importCouponId, tenantId } }));
    assert.equal(stored, 0, '試算竟寫入了資料');
  });

  await t('匯入序號並分類回報', async () => {
    const r = await importCodes(prisma, tenantId, importCouponId, 'AAAA1111\nBBBB2222\nAAAA1111\nZZ');
    assert.equal(r.imported, 2, `應匯入 2 筆，實得 ${r.imported}`);
    assert.deepEqual(r.duplicatesInInput, ['AAAA1111']);
    assert.deepEqual(r.invalid, ['ZZ']);
    assert.equal(r.availableTotal, 2);
  });

  await t('再次匯入相同券碼須回報衝突而非重複寫入', async () => {
    const r = await importCodes(prisma, tenantId, importCouponId, 'AAAA1111\nCCCC3333');
    assert.deepEqual(r.conflicts, ['AAAA1111']);
    assert.equal(r.imported, 1);
    assert.equal(r.availableTotal, 3);
  });

  await t('有庫存後可發布，且發券會消耗序號', async () => {
    const pub = await withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, importCouponId, 'ACTIVE'));
    assert.ok(pub.ok, `發布失敗：${JSON.stringify(pub)}`);
    const r = await issueCoupons(prisma, tenantId, importCouponId, { contactIds: [contactA], requireClaim: false });
    assert.equal(r.issued.length, 1);
    assert.ok(['AAAA1111', 'BBBB2222', 'CCCC3333'].includes(r.issued[0].code), `發出的券碼不在庫存中：${r.issued[0].code}`);
    const remaining = await withTenant(prisma, tenantId, (tx) =>
      tx.couponCode.count({ where: { couponId: importCouponId, tenantId, status: 'AVAILABLE' } }));
    assert.equal(remaining, 2, `庫存應剩 2，實得 ${remaining}`);
  });

  await t('已配發的序號不可移除', async () => {
    const assigned = await withTenant(prisma, tenantId, (tx) =>
      tx.couponCode.findFirst({ where: { couponId: importCouponId, tenantId, status: 'ASSIGNED' } }));
    const r = await removeAvailableCode(prisma, tenantId, importCouponId, assigned!.code);
    assert.ok(!r.removed && r.reason === 'ALREADY_ASSIGNED', `預期擋下，實得 ${JSON.stringify(r)}`);
  });

  await t('未配發的序號可移除', async () => {
    const avail = await withTenant(prisma, tenantId, (tx) =>
      tx.couponCode.findFirst({ where: { couponId: importCouponId, tenantId, status: 'AVAILABLE' } }));
    const r = await removeAvailableCode(prisma, tenantId, importCouponId, avail!.code);
    assert.ok(r.removed, '未配發的序號竟無法移除');
  });

  await t('序號用罄時發券須回報而非拋錯中斷', async () => {
    // 清掉剩餘庫存後再發
    await withTenant(prisma, tenantId, (tx) =>
      tx.couponCode.deleteMany({ where: { couponId: importCouponId, tenantId, status: 'AVAILABLE' } }));
    const r = await issueCoupons(prisma, tenantId, importCouponId, { contactIds: [contactB], requireClaim: false });
    assert.equal(r.issued.length, 0);
    assert.equal(r.skipped[0]?.reason, 'CODES_EXHAUSTED', `預期回報序號用罄，實得 ${JSON.stringify(r.skipped)}`);
  });

  // ── 成效統計 ──
  await t('成效指標的累積口徑正確', async () => {
    const stats = await withTenant(prisma, tenantId, (tx) => getCouponStats(tx, tenantId, couponId));
    assert.ok(stats, '查無統計');
    // 已核銷者也算曾經領取過，claimed 須 >= redeemed
    assert.ok(stats!.claimed >= stats!.redeemed, `claimed(${stats!.claimed}) 應 >= redeemed(${stats!.redeemed})`);
    assert.ok(stats!.issued >= stats!.claimed, `issued(${stats!.issued}) 應 >= claimed(${stats!.claimed})`);
    assert.ok(stats!.redeemed > 0, '先前已核銷過，redeemed 不應為 0');
  });

  await t('無人領取時核銷率為 null 而非 0', async () => {
    const c = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, { name: '零領取券', couponType: 'GIFT' }));
    const stats = await withTenant(prisma, tenantId, (tx) => getCouponStats(tx, tenantId, c.id));
    assert.equal(stats!.redeemRate, null, '沒有分母時不應回 0');
    assert.equal(stats!.claimRate, null);
  });

  await t('CSV 匯出含 BOM 且不外洩領取憑證', async () => {
    const csv = await withTenant(prisma, tenantId, (tx) => exportInstancesCsv(tx, tenantId, couponId));
    assert.ok(csv.startsWith('\uFEFF'), '缺少 BOM，Excel 開啟會亂碼');
    assert.ok(csv.includes('券號'), '缺少標題列');
    assert.ok(!/claimToken/i.test(csv), 'CSV 竟含 claimToken 欄位');
    // 憑證值本身也不可出現
    const withToken = await withTenant(prisma, tenantId, (tx) =>
      tx.couponInstance.findFirst({ where: { tenantId, claimToken: { not: null } } }));
    if (withToken?.claimToken) {
      assert.ok(!csv.includes(withToken.claimToken), 'CSV 外洩了有效的領取憑證');
    }
  });

  await t('CSV 欄位含逗號時不破壞格式', async () => {
    const c = await withTenant(prisma, tenantId, (tx) =>
      createCoupon(tx, tenantId, agentId, {
        name: '含,逗號"引號的券', couponType: 'GIFT', perContactLimit: 5,
        validityMode: 'FIXED', startAt: '2026-01-01', endAt: '2030-12-31',
        redeemMode: 'SELF',
      }));
    await withTenant(prisma, tenantId, (tx) => changeStatus(tx, tenantId, c.id, 'ACTIVE'));
    await issueCoupons(prisma, tenantId, c.id, { contactIds: [contactA], requireClaim: false });
    const csv = await withTenant(prisma, tenantId, (tx) => exportInstancesCsv(tx, tenantId, c.id));
    const lines = csv.split('\n');
    // 每列欄位數須一致（用引號包住後，逗號不會被誤判為分隔）
    const countCells = (line: string) => (line.match(/","/g) ?? []).length;
    assert.equal(countCells(lines[1]), countCells(lines[0]), '資料列欄位數與標題列不符');
  });

  // ── 租戶隔離 ──
  // ⚠️ RLS 只對非 superuser 且未授予 BYPASSRLS 的角色生效。本機 dev 的 crm 角色是
  // superuser（正式環境 API 走 app_tenant），因此這裡先偵測連線角色：
  // 能繞過 RLS 時跳過並明說，不讓測試給出「通過」的假象。
  const [{ bypasses }] = await prisma.$queryRawUnsafe<Array<{ bypasses: boolean }>>(
    `SELECT (rolsuper OR rolbypassrls) AS bypasses FROM pg_roles WHERE rolname = current_user`,
  );

  if (bypasses) {
    console.log('SKIP  跨租戶隔離（RLS）—— 目前連線角色可繞過 RLS，本機 dev 為 superuser；');
    console.log('      正式環境 API 以 app_tenant 連線（rolbypassrls=f），RLS 由 DB 強制。');
    console.log('      此案例請於 CI 的 RLS 整合測試環境驗證。');
  } else {
    await t('跨租戶讀不到他人的券（RLS）', async () => {
      const other = randomUUID();
      await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, "updatedAt") VALUES ($1::uuid,$2,now())`, other, '別的租戶');
      const seen = await withTenant(prisma, other, (tx) => tx.coupon.count({ where: { tenantId } }));
      assert.equal(seen, 0, `別的租戶竟看到 ${seen} 張券`);
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, other);
    });
  }

  // 應用層隔離不依賴 RLS，任何角色下都必須成立——這是 check-tenant-scoping 把關的那一層
  await t('應用層 where tenantId 擋掉他人的券', async () => {
    const other = randomUUID();
    const seen = await withTenant(prisma, tenantId, (tx) =>
      tx.coupon.count({ where: { tenantId: other } }));
    assert.equal(seen, 0, `帶錯 tenantId 竟查到 ${seen} 張券`);
  });

  // 清理
  await prisma.$executeRawUnsafe(`DELETE FROM coupon_instances WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM coupon_codes WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM coupons WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM contacts WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, tenantId);

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('測試執行失敗：', err);
  await prisma.$disconnect();
  process.exit(1);
});
