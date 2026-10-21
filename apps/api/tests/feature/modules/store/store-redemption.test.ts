/**
 * 門市與店員核銷台（add-coupon-system A10、design D13）。
 *
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線。
 * 重試鍵用記憶體儲存，不碰 Redis。本檔建立的門市、帳號、券以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { loadEnvConfig, getConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { isAgentAccessToken } from '#src/lib/agent-token.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { getFanCoupon } from '#src/modules/coupon/coupon-fan.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { importCodes } from '#src/modules/coupon/coupon-import.service.js';
import { getWalletQrCode } from '#src/modules/coupon/coupon-wallet.service.js';
import {
  createStore,
  updateStore,
  listStores,
  createStoreAccount,
  updateStoreAccount,
  resetStoreAccountPassword,
  forceLogoutStoreAccount,
  StoreConflictError,
  StoreValidationError,
} from '#src/modules/store/store.service.js';
import {
  loginStoreAccount,
  authorizeStoreSession,
  lookupStoreCoupon,
  redeemAtStore,
  listTodayRedemptions,
  verifyStoreToken,
  type StoreConsoleDeps,
  type StoreSession,
} from '#src/modules/store/store-console.service.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `store-test-${Date.now().toString(36)}`;
const agentId = randomUUID();
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const clock = { now: Date.now() };
const deps: StoreConsoleDeps = {
  store: memBindingStore(clock),
  now: () => clock.now,
  // 測試以 owner 連線依帳號名稱找租戶（正式版在 modules/auth 以 prismaAdmin 查）
  resolveTenant: async (username) =>
    (await owner.storeAccount.findUnique({ where: { username }, select: { tenantId: true } }))?.tenantId ?? null,
};

const inTenant = <R>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<R>) => withTenant(prisma, T, fn);
const uname = (s: string) => `${MARK}-${s}`.slice(0, 32);

let storeId = '';
let storeName = '';
let otherStoreId = '';
let scanCouponId = '';
let codeCouponId = '';
let contactId = '';

async function account(s: string, opts: { store?: string; password?: string } = {}) {
  const username = uname(s);
  await inTenant((tx) =>
    createStoreAccount(tx, T, { storeId: opts.store ?? storeId, username, password: opts.password ?? 'dt3c2026x' }));
  return username;
}

async function login(username: string, password = 'dt3c2026x') {
  const r = await loginStoreAccount(prisma, deps, username, password, true);
  assert.ok(r.ok, `登入失敗：${JSON.stringify(r)}`);
  return r;
}

async function sessionOf(username: string): Promise<StoreSession> {
  const r = await login(username);
  if (!r.ok) throw new Error('unreachable');
  const payload = verifyStoreToken(r.token);
  assert.ok(payload);
  return payload;
}

/** 直接寫入一張券（指定狀態與時間） */
async function instance(couponId: string, code: string, extra: Record<string, unknown> = {}) {
  return owner.couponInstance.create({
    data: { tenantId: T, couponId, contactId, code, status: 'CLAIMED', claimedAt: new Date(), ...extra },
  });
}

beforeAll(async () => {
  contactId = (await owner.contact.create({ data: { tenantId: T, displayName: '陳大明', avatarUrl: MARK } })).id;
  const s = await inTenant((tx) => createStore(tx, T, { name: `${MARK} 內湖門市` }));
  storeId = s.id;
  storeName = s.name;
  otherStoreId = (await inTenant((tx) => createStore(tx, T, { name: `${MARK} 信義門市` }))).id;
  const base = {
    purpose: 'MARKETING' as const, validityMode: 'AFTER_CLAIM' as const, afterClaimDays: 30,
    codeMode: 'UNIQUE_CODE' as const, perContactLimit: 50,
  };
  const scan = await inTenant((tx) =>
    createCoupon(tx, T, agentId, { ...base, name: `${MARK} 掃碼券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, minSpend: 1000, redeemMode: 'STAFF_SCAN' }));
  const code = await inTenant((tx) =>
    createCoupon(tx, T, agentId, { ...base, name: `${MARK} 驗證碼券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 200, redeemMode: 'STAFF_CODE', staffCode: '582917' }));
  scanCouponId = scan.id;
  codeCouponId = code.id;
  for (const id of [scanCouponId, codeCouponId]) await inTenant((tx) => changeStatus(tx, T, id, 'ACTIVE'));
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: agentId } });
  await owner.storeAccount.deleteMany({ where: { username: { startsWith: MARK } } });
  await owner.store.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.contact.deleteMany({ where: { tenantId: T, avatarUrl: MARK } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('管理者可管理門市與門市帳號', () => {
  it('建立門市帳號', async () => {
    const username = uname('create');
    const acc = await inTenant((tx) => createStoreAccount(tx, T, { storeId, username, password: 'dt3c2026x' }));
    assert.equal(acc.username, username);
    assert.equal(acc.canRedeem, true);
    assert.ok(!('passwordHash' in acc), '回應不可含密碼雜湊');
  });

  it('帳號名稱重複', async () => {
    const username = uname('dup');
    const otherStore = await withTenant(prisma, TENANT_B, (tx) => createStore(tx, TENANT_B, { name: `${MARK} 他租戶門市` }));
    await withTenant(prisma, TENANT_B, (tx) => createStoreAccount(tx, TENANT_B, { storeId: otherStore.id, username, password: 'dt3c2026x' }));
    await assert.rejects(
      () => inTenant((tx) => createStoreAccount(tx, T, { storeId, username, password: 'dt3c2026x' })),
      (err: Error) => err instanceof StoreConflictError && err.message === '此帳號名稱已被使用',
    );
  });

  it('帳號名稱格式不符', async () => {
    await assert.rejects(
      () => inTenant((tx) => createStoreAccount(tx, T, { storeId, username: 'DT3C Neihu', password: 'dt3c2026x' })),
      StoreValidationError,
    );
  });

  it('列表不含其他租戶的門市', async () => {
    const list = await inTenant((tx) => listStores(tx, T));
    assert.ok(list.some((s) => s.id === storeId));
    assert.ok(list.every((s) => !s.name.includes('他租戶門市')));
    assert.ok(list.every((s) => s.accounts.every((a) => !('passwordHash' in a))));
  });
});

describe('門市帳號登入核銷台', () => {
  it('登入成功', async () => {
    const username = await account('login-ok');
    const r = await login(username);
    assert.ok(r.ok);
    assert.equal(r.ok && r.storeName, storeName);
    const decoded = jwt.decode(r.ok ? r.token : '') as { exp: number; iat: number };
    assert.equal(decoded.exp - decoded.iat, 30 * 24 * 60 * 60);
  });

  it('帳號或密碼錯誤', async () => {
    const username = await account('login-bad');
    const wrong = await loginStoreAccount(prisma, deps, username, 'wrong-pass', true);
    const missing = await loginStoreAccount(prisma, deps, uname('nobody'), 'dt3c2026x', true);
    assert.deepEqual(wrong, { ok: false, code: 'INVALID_CREDENTIALS' });
    assert.deepEqual(missing, { ok: false, code: 'INVALID_CREDENTIALS' });
  });

  it('密碼錯誤 5 次後鎖定', async () => {
    const username = await account('lock');
    for (let i = 0; i < 5; i++) await loginStoreAccount(prisma, deps, username, 'wrong-pass', true);
    const locked = await loginStoreAccount(prisma, deps, username, 'dt3c2026x', true);
    assert.equal(!locked.ok && locked.code, 'ACCOUNT_LOCKED');
    assert.ok(!locked.ok && locked.lockedUntil instanceof Date);
    clock.now += 15 * MIN + 1000;
    try {
      const ok = await loginStoreAccount(prisma, deps, username, 'dt3c2026x', true);
      assert.ok(ok.ok, JSON.stringify(ok));
    } finally {
      clock.now -= 15 * MIN + 1000;
    }
  });

  it('門市憑證不能用於後台', async () => {
    const username = await account('not-agent');
    const r = await login(username);
    const decoded = jwt.verify(r.ok ? r.token : '', getConfig().JWT_SECRET) as Record<string, unknown>;
    assert.equal(isAgentAccessToken(decoded), false);
  });
});

describe('核銷台每次操作都檢查帳號狀態', () => {
  it('帳號被停用', async () => {
    const username = await account('disabled');
    const session = await sessionOf(username);
    await inTenant((tx) => updateStoreAccount(tx, T, session.accountId, { isActive: false }));
    const r = await authorizeStoreSession(prisma, session, { requireRedeem: true });
    assert.equal(!r.ok && r.code, 'STORE_ACCOUNT_DISABLED');
  });

  it('密碼被重設', async () => {
    const username = await account('pw-reset');
    const session = await sessionOf(username);
    await inTenant((tx) => resetStoreAccountPassword(tx, T, session.accountId, 'new-pass-2026'));
    const r = await authorizeStoreSession(prisma, session, { requireRedeem: true });
    assert.equal(!r.ok && r.code, 'PASSWORD_CHANGED');
  });

  it('強制登出', async () => {
    const username = await account('kicked');
    const session = await sessionOf(username);
    await inTenant((tx) => forceLogoutStoreAccount(tx, T, session.accountId));
    const r = await authorizeStoreSession(prisma, session, { requireRedeem: false });
    assert.equal(!r.ok && r.code, 'SESSION_REVOKED');
  });

  it('沒有核銷權限', async () => {
    const username = await account('no-perm');
    const session = await sessionOf(username);
    await inTenant((tx) => updateStoreAccount(tx, T, session.accountId, { canRedeem: false }));
    const redeem = await authorizeStoreSession(prisma, session, { requireRedeem: true });
    assert.equal(!redeem.ok && redeem.code, 'NO_REDEEM_PERMISSION');
    const me = await authorizeStoreSession(prisma, session, { requireRedeem: false });
    assert.ok(me.ok);
    assert.equal(me.ok && me.account.canRedeem, false);
  });

  it('門市停業', async () => {
    const closed = await inTenant((tx) => createStore(tx, T, { name: `${MARK} 停業門市` }));
    const username = await account('closed', { store: closed.id });
    const session = await sessionOf(username);
    await inTenant((tx) => updateStore(tx, T, closed.id, { isActive: false }));
    const r = await authorizeStoreSession(prisma, session, { requireRedeem: true });
    assert.equal(!r.ok && r.code, 'STORE_CLOSED');
  });
});

describe('租戶停用', () => {
  it('租戶停用後門市帳號不能登入，已登入的裝置也被擋下', async () => {
    const username = await account('tenant-off');
    const session = await sessionOf(username);
    await owner.tenant.update({ where: { id: T }, data: { isActive: false } });
    try {
      const r = await loginStoreAccount(prisma, deps, username, 'dt3c2026x', true);
      assert.equal(!r.ok && r.code, 'TENANT_DISABLED');
      const a = await authorizeStoreSession(prisma, session, { requireRedeem: false });
      assert.equal(!a.ok && a.code, 'TENANT_DISABLED');
    } finally {
      await owner.tenant.update({ where: { id: T }, data: { isActive: true } });
    }
  });
});

describe('查券不改變券的狀態', () => {
  let session: StoreSession;
  beforeAll(async () => {
    session = await sessionOf(await account('lookup'));
  });

  it('查詢可核銷的券', async () => {
    const inst = await instance(scanCouponId, `AUTUMN-${MARK.slice(-4).toUpperCase()}-OK01`);
    const r = await lookupStoreCoupon(prisma, session, inst.code.toLowerCase().replace(/-/g, ''), clock.now);
    assert.equal(r.result, 'OK');
    assert.equal(r.coupon?.customerName, '陳◯明');
    assert.equal(r.coupon?.code, inst.code);
    const after = await owner.couponInstance.findUnique({ where: { id: inst.id } });
    assert.equal(after?.status, 'CLAIMED');
  });

  it('查詢無法核銷的券', async () => {
    const used = await instance(scanCouponId, `${MARK}-USED`, {
      status: 'REDEEMED', redeemedAt: new Date('2026-10-05T06:31:00Z'), redeemedStoreName: '信義門市',
    });
    const expired = await instance(scanCouponId, `${MARK}-EXPD`, { expiresAt: new Date(clock.now - DAY) });
    const r1 = await lookupStoreCoupon(prisma, session, used.code, clock.now);
    assert.equal(r1.result, 'USED');
    assert.equal(r1.redeemedStoreName, '信義門市');
    assert.ok(r1.redeemedAt);
    const r2 = await lookupStoreCoupon(prisma, session, expired.code, clock.now);
    assert.equal(r2.result, 'EXPIRED');
    assert.ok(r2.expiresAt);
  });

  it('需在顧客手機上核銷', async () => {
    const inst = await instance(codeCouponId, `${MARK}-CODE`);
    const r = await lookupStoreCoupon(prisma, session, inst.code, clock.now);
    assert.equal(r.result, 'WRONG_MODE');
    assert.equal(r.coupon?.redeemMode, 'STAFF_CODE');
  });

  it('查無此券', async () => {
    const r = await lookupStoreCoupon(prisma, session, 'NOPE-0000-0000', clock.now);
    assert.equal(r.result, 'NOT_FOUND');
    assert.equal(r.coupon, undefined);
  });
});

describe('核銷台核銷記錄門市且可安全重試', () => {
  let session: StoreSession;
  beforeAll(async () => {
    session = await sessionOf(await account('redeem'));
  });

  it('確認核銷', async () => {
    const inst = await instance(scanCouponId, `${MARK}-RDM1`);
    const r = await redeemAtStore(prisma, deps, session, inst.code, randomUUID());
    assert.ok(r.ok, JSON.stringify(r));
    const after = await owner.couponInstance.findUnique({ where: { id: inst.id } });
    assert.equal(after?.status, 'REDEEMED');
    assert.equal(after?.redeemMode, 'STAFF_SCAN');
    assert.equal(after?.redeemedStoreId, storeId);
    const view = await getFanCoupon(prisma, { tenantId: T, contactId }, inst.id);
    assert.equal(view?.redeemedStoreName, storeName);
  });

  it('網路重試不重複核銷', async () => {
    const inst = await instance(scanCouponId, `${MARK}-RDM2`);
    const key = randomUUID();
    const first = await redeemAtStore(prisma, deps, session, inst.code, key);
    const again = await redeemAtStore(prisma, deps, session, inst.code, key);
    assert.ok(first.ok && again.ok);
    assert.equal(first.ok && again.ok && again.redeemedAt.getTime(), first.ok ? first.redeemedAt.getTime() : 0);
  });

  it('兩台手機同時核銷', async () => {
    const other = await sessionOf(await account('redeem-b', { store: otherStoreId }));
    const inst = await instance(scanCouponId, `${MARK}-RDM3`);
    const [a, b] = await Promise.all([
      redeemAtStore(prisma, deps, session, inst.code, randomUUID()),
      redeemAtStore(prisma, deps, other, inst.code, randomUUID()),
    ]);
    const oks = [a, b].filter((x) => x.ok);
    const fails = [a, b].filter((x) => !x.ok);
    assert.equal(oks.length, 1);
    assert.equal(fails.length, 1);
    const fail = fails[0];
    assert.equal(!fail.ok && fail.reason, 'ALREADY_REDEEMED');
    assert.ok(!fail.ok && fail.redeemedStoreName);
  });
});

describe('今日核銷紀錄', () => {
  it('只顯示本門市今天的紀錄', async () => {
    const today = await inTenant((tx) => createStore(tx, T, { name: `${MARK} 今日門市` }));
    const session = await sessionOf(await account('today', { store: today.id }));
    const big = await inTenant((tx) =>
      createCoupon(tx, T, agentId, {
        name: `${MARK} 兩百券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 200, purpose: 'MARKETING',
        validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_SCAN', perContactLimit: 50,
      }));
    await inTenant((tx) => changeStatus(tx, T, big.id, 'ACTIVE'));
    for (const [cid, code] of [[scanCouponId, `${MARK}-TD1`], [big.id, `${MARK}-TD2`]] as const) {
      await instance(cid, code);
      assert.ok((await redeemAtStore(prisma, deps, session, code, randomUUID())).ok);
    }
    // 昨天、其他門市各一筆
    await instance(scanCouponId, `${MARK}-YDAY`, {
      status: 'REDEEMED', redeemedAt: new Date(clock.now - DAY - MIN), redeemedStoreId: today.id, redeemMode: 'STAFF_SCAN',
    });
    await instance(scanCouponId, `${MARK}-OTHR`, {
      status: 'REDEEMED', redeemedAt: new Date(), redeemedStoreId: otherStoreId, redeemMode: 'STAFF_SCAN',
    });
    const r = await listTodayRedemptions(prisma, session, clock.now);
    assert.equal(r.items.length, 2);
    assert.equal(r.summary.discountTotal, 300);
    assert.ok(r.items.every((i) => i.customerName === '陳◯明'));
  });
});

describe('共用碼券', () => {
  let session: StoreSession;
  let sharedId = '';
  const SHARED = `S${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
  beforeAll(async () => {
    session = await sessionOf(await account('shared'));
    const c = await inTenant((tx) =>
      createCoupon(tx, T, agentId, {
        name: `${MARK} 共用碼券`, purpose: 'MARKETING', couponType: 'DISCOUNT_AMOUNT', discountAmount: 50,
        validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'SHARED_CODE', sharedCode: SHARED,
        redeemMode: 'STAFF_SCAN', perContactLimit: 5,
      }));
    sharedId = c.id;
    assert.ok((await inTenant((tx) => changeStatus(tx, T, sharedId, 'ACTIVE'))).ok);
  });

  it('共用碼可以發給多位顧客，顧客看到的都是共用碼', async () => {
    const other = (await owner.contact.create({ data: { tenantId: T, displayName: '林小華', avatarUrl: MARK } })).id;
    const r = await issueCoupons(prisma, T, sharedId, { contactIds: [contactId, other], issuedVia: 'keyword' });
    assert.equal(r.issued.length, 2, JSON.stringify(r.skipped));
    for (const i of r.issued) {
      const view = await getFanCoupon(prisma, { tenantId: T, contactId: i.contactId! }, i.id, clock.now);
      assert.equal(view?.code, SHARED);
    }
  });

  it('核銷台掃描共用碼券的 QR Code 找得到是哪一位顧客', async () => {
    const r = await issueCoupons(prisma, T, sharedId, { contactIds: [contactId], issuedVia: 'keyword' });
    const inst = await owner.couponInstance.findUnique({ where: { id: r.issued[0].id } });
    assert.ok(inst && inst.code !== SHARED, '每張共用碼券有自己的內部券號');
    // 顧客手機上的 QR Code 內容是這張券自己的券號，不是共用碼
    const qr = await getWalletQrCode(prisma, { tenantId: T, contactId }, inst.id, clock.now);
    assert.ok(qr.ok);
    assert.equal(qr.dataUrl, await QRCode.toDataURL(inst.code, { margin: 1, width: 480, errorCorrectionLevel: 'M' }));
    const found = await lookupStoreCoupon(prisma, session, inst.code, clock.now);
    assert.equal(found.result, 'OK');
    assert.equal(found.coupon?.instanceId, inst.id);
  });

  it('核銷台輸入共用券號', async () => {
    const found = await lookupStoreCoupon(prisma, session, SHARED.toLowerCase(), clock.now);
    assert.equal(found.result, 'SHARED_CODE');
  });
});

describe('序號包', () => {
  it('去掉連字號後相同的序號不能匯入', async () => {
    const c = await inTenant((tx) =>
      createCoupon(tx, T, agentId, {
        name: `${MARK} 序號包`, purpose: 'MARKETING', couponType: 'DISCOUNT_AMOUNT', discountAmount: 50,
        validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'IMPORTED_CODES',
        redeemMode: 'STAFF_SCAN', perContactLimit: 5,
      }));
    const base = `${Date.now().toString(36).toUpperCase()}`.slice(-6);
    const first = await importCodes(prisma, T, c.id, `AB-${base}`);
    assert.equal(first.imported, 1);
    const second = await importCodes(prisma, T, c.id, `A-B${base}\nAB${base}`);
    assert.equal(second.imported, 0);
    assert.deepEqual(second.conflicts, [`A-B${base}`]);
    assert.deepEqual(second.duplicatesInInput, [`AB${base}`]);
  });
});
