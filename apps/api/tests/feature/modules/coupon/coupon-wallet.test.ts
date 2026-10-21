/**
 * 顧客票券夾（add-coupon-system A9、design D12）：票券連結、歸戶驗證、FB／IG 直接歸戶、
 * 券夾分頁、店員驗證碼核銷時段、店員掃碼完成查詢。
 *
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線。
 * 票券連結與核銷時段用記憶體儲存（時間可快轉），不碰 Redis。
 * 本檔建立的券以 createdById 標記、聯絡人與渠道以 MARK 前綴標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { verifyFanToken } from '#src/modules/portal/portal-auth.service.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { issueInConversation, type InboxIssueDeps } from '#src/modules/coupon/coupon-inbox.service.js';
import {
  openWalletSession,
  listWallet,
  getWalletCoupon,
  startStaffCodeSession,
  redeemWithStaffCode,
  getWalletQrCode,
  type WalletDeps,
} from '#src/modules/coupon/coupon-wallet.service.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-wallet-${Date.now()}`;
const agentId = randomUUID();
/** 發券座席（對話訊息的寄件者須是真的座席） */
let issuer = '';
const DAY = 24 * 60 * 60 * 1000;

const clock = { now: Date.now() };
const deps: WalletDeps = {
  store: memBindingStore(clock),
  now: () => clock.now,
};
// 對話發券：與票券夾共用同一個儲存與時鐘，測試不真的送訊息，記下送出的文字
const inboxDeps: InboxIssueDeps = {
  ...deps,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (_tx, params) => {
    delivered.push(params);
    return { sent: true };
  },
};
const delivered: Array<{ conversationId: string; text: string }> = [];

let originalSettings: unknown = null;
let lineChannel = '';
let fbChannel = '';
let couponId = '';

interface Person {
  contactId: string;
  conversationId: string;
}

async function person(name: string, channelId: string, channelType: 'LINE' | 'FB', opts: { verified?: boolean; phone?: string } = {}) {
  const contact = await owner.contact.create({
    data: {
      tenantId: T,
      displayName: `${MARK}-${name}`,
      phone: opts.phone ?? null,
      ...(opts.verified ? { identityVerifiedAt: new Date(), identityVerifiedVia: 'phone' } : {}),
    },
  });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId, channelType, uid: `${MARK}-${name}`, profileName: name },
  });
  const conv = await owner.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId, channelType } });
  return { contactId: contact.id, conversationId: conv.id } satisfies Person;
}

/** 在對話中發一張券，回傳票券連結的權杖（從送出的訊息取出，確保顧客真的收得到） */
async function issue(p: Person, id = couponId): Promise<{ token: string; instanceId: string }> {
  const r = await issueInConversation(prisma, inboxDeps, {
    tenantId: T, couponId: id, conversationId: p.conversationId, agentId: issuer, agentName: '王小美',
    expectedAssigneeId: null, requestKey: randomUUID(),
  });
  assert.ok(r.ok, `發券失敗：${JSON.stringify(r)}`);
  const msg = delivered.filter((d) => d.conversationId === p.conversationId).at(-1)!;
  const token = /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
  assert.ok(token, '訊息內必須有票券連結');
  return { token, instanceId: r.instanceId };
}

async function fanOf(p: Person, token: string) {
  const s = await openWalletSession(prisma, deps, token);
  assert.equal(s.status, 'ok', `換憑證失敗：${JSON.stringify(s)}`);
  return s.status === 'ok' ? { tenantId: s.tenantId, contactId: s.contactId } : { tenantId: T, contactId: p.contactId };
}

beforeAll(async () => {
  const settings = await owner.tenantSettings.findUnique({ where: { tenantId: T }, select: { identityBinding: true } });
  originalSettings = settings?.identityBinding ?? {};
  await owner.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { phoneEnabled: true } },
    update: { identityBinding: { phoneEnabled: true } },
  });
  invalidateIdentityBindingSettings();
  const mk = (channelType: 'LINE' | 'FB') =>
    owner.channel.create({ data: { tenantId: T, channelType, displayName: `${MARK}-${channelType}`, credentialsEncrypted: 'x', isActive: true } });
  issuer = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '王小美', passwordHash: 'x' } })).id;
  lineChannel = (await mk('LINE')).id;
  fbChannel = (await mk('FB')).id;
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(tx, T, agentId, {
      name: `${MARK} 店員驗證碼券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, minSpend: 1000, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'WAL',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 20,
    }));
  couponId = c.id;
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(tx, T, couponId, 'ACTIVE'))).ok);
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: agentId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.message.deleteMany({ where: { conversation: { tenantId: T, contact: contacts } } });
  await owner.conversation.deleteMany({ where: { tenantId: T, contact: contacts } });
  await owner.contactTag.deleteMany({ where: { contact: contacts } });
  await owner.contactMergeLog.deleteMany({ where: { tenantId: T, survivor: contacts } }).catch(() => undefined);
  await owner.contact.deleteMany({ where: contacts });
  await owner.channel.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { tenantId: T, email: `${MARK}@example.com` } });
  await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: originalSettings as object } });
  invalidateIdentityBindingSettings();
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('顧客須完成歸戶驗證才能開啟票券夾', () => {
  it('已歸戶的顧客開啟票券連結', async () => {
    const p = await person('已歸戶', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const s = await openWalletSession(prisma, deps, token);
    assert.equal(s.status, 'ok');
    if (s.status !== 'ok') return;
    assert.equal(s.instanceId, instanceId);
    const payload = verifyFanToken(s.fanToken);
    assert.equal(payload?.contactId, p.contactId);
    assert.equal(payload?.tenantId, T);
    const wallet = await listWallet(prisma, { tenantId: T, contactId: p.contactId });
    assert.ok(wallet.items.some((i) => i.id === instanceId));
  });

  it('未歸戶的顧客開啟票券連結', async () => {
    const p = await person('未歸戶', lineChannel, 'LINE');
    const { token } = await issue(p);
    const s = await openWalletSession(prisma, deps, token);
    assert.equal(s.status, 'verification_required');
    if (s.status !== 'verification_required') return;
    assert.equal(s.kind, 'phone');
    assert.match(s.registrationUrl, /^\/bind\/phone\/[A-Za-z0-9_-]+\?next=/);
    assert.equal(new URL(s.registrationUrl, 'https://x').searchParams.get('next'), `/coupon/open/${token}`);
  });

  it('客服手動填寫的手機不算歸戶', async () => {
    const p = await person('客服填手機', lineChannel, 'LINE', { phone: '0912000111' });
    const { token } = await issue(p);
    assert.equal((await openWalletSession(prisma, deps, token)).status, 'verification_required');
  });

  it('租戶沒有啟用任何登記方式', async () => {
    const p = await person('沒啟用', lineChannel, 'LINE');
    const { token } = await issue(p);
    await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: {} } });
    invalidateIdentityBindingSettings();
    try {
      assert.equal((await openWalletSession(prisma, deps, token)).status, 'unavailable');
    } finally {
      await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: { phoneEnabled: true } } });
      invalidateIdentityBindingSettings();
    }
  });
});

describe('票券連結', () => {
  it('開啟有效連結', async () => {
    const p = await person('重複開啟', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    await openWalletSession(prisma, deps, token);
    clock.now += 6 * DAY;
    try {
      const again = await openWalletSession(prisma, deps, token);
      assert.equal(again.status, 'ok');
      assert.equal(again.status === 'ok' && again.instanceId, instanceId);
    } finally {
      clock.now -= 6 * DAY;
    }
  });

  it('連結過期', async () => {
    const p = await person('過期連結', lineChannel, 'LINE', { verified: true });
    const { token } = await issue(p);
    clock.now += 8 * DAY;
    try {
      assert.equal((await openWalletSession(prisma, deps, token)).status, 'expired');
    } finally {
      clock.now -= 8 * DAY;
    }
  });

  it('聯絡人已合併', async () => {
    const fb = await person('合併FB', fbChannel, 'FB');
    const line = await person('合併LINE', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(fb);
    // 以 owner 模擬合併：被合併方封存並指向保留方，券跟著移動
    await owner.contact.update({ where: { id: fb.contactId }, data: { isArchived: true, mergedIntoId: line.contactId } });
    await owner.couponInstance.update({ where: { id: instanceId }, data: { contactId: line.contactId } });
    const s = await openWalletSession(prisma, deps, token);
    assert.equal(s.status, 'ok');
    assert.equal(s.status === 'ok' && s.contactId, line.contactId);
  });

  it('只能存取自己的券', async () => {
    const a = await person('甲', lineChannel, 'LINE', { verified: true });
    const b = await person('乙', lineChannel, 'LINE', { verified: true });
    const { instanceId } = await issue(b);
    assert.equal(await getWalletCoupon(prisma, { tenantId: T, contactId: a.contactId }, instanceId), null);
    // 其他租戶的顧客憑證也拿不到
    assert.equal(await getWalletCoupon(prisma, { tenantId: TENANT_B, contactId: b.contactId }, instanceId), null);
  });
});

describe('待領取的券憑領取憑證歸戶', () => {
  it('FB 或 IG 對話中發出的券', async () => {
    const p = await person('FB顧客', fbChannel, 'FB');
    const { instanceId } = await issue(p);
    const instance = await owner.couponInstance.findUnique({ where: { id: instanceId } });
    assert.equal(instance?.status, 'CLAIMED');
    assert.equal(instance?.contactId, p.contactId);
    assert.equal(instance?.claimToken, null);
  });
});

describe('顧客可於券夾查看持有的券', () => {
  it('分頁數量', async () => {
    const p = await person('分頁', lineChannel, 'LINE', { verified: true });
    const fan = await fanOf(p, (await issue(p)).token);
    await issue(p);
    const used = await issue(p);
    const expired = await issue(p);
    await owner.couponInstance.update({ where: { id: used.instanceId }, data: { status: 'REDEEMED', redeemedAt: new Date() } });
    await owner.couponInstance.update({ where: { id: expired.instanceId }, data: { expiresAt: new Date(clock.now - DAY) } });
    const wallet = await listWallet(prisma, fan, clock.now);
    assert.deepEqual(wallet.counts, { available: 2, used: 1, invalid: 1 });
    assert.equal(wallet.items.find((i) => i.id === expired.instanceId)?.walletStatus, 'EXPIRED');
  });

  it('活動提前結束的券註明原因', async () => {
    const c = await withTenant(prisma, T, (tx) =>
      createCoupon(tx, T, agentId, {
        name: `${MARK} 會提前結束`, couponType: 'GIFT', giftName: '濾網', purpose: 'SERVICE', validityMode: 'AFTER_CLAIM',
        afterClaimDays: 30, codeMode: 'UNIQUE_CODE', redeemMode: 'SELF',
      }));
    await withTenant(prisma, T, (tx) => changeStatus(tx, T, c.id, 'ACTIVE'));
    const p = await person('提前結束', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p, c.id);
    const fan = await fanOf(p, token);
    await withTenant(prisma, T, (tx) => changeStatus(tx, T, c.id, 'ENDED'));
    const view = await getWalletCoupon(prisma, fan, instanceId);
    assert.equal(view?.walletStatus, 'ENDED');
  });
});

describe('店員驗證碼核銷須在時限內完成', () => {
  async function started() {
    const p = await person(`核銷-${randomUUID().slice(0, 6)}`, lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    const s = await startStaffCodeSession(prisma, deps, fan, instanceId);
    assert.ok(s.ok, `開始使用失敗：${JSON.stringify(s)}`);
    // 回傳以伺服器時間算的剩餘毫秒：顧客手機時鐘不準時倒數也正確
    assert.equal(s.ok && s.remainingMs, 5 * 60 * 1000);
    return { fan, instanceId };
  }

  it('時段內輸入正確驗證碼', async () => {
    const { fan, instanceId } = await started();
    const r = await redeemWithStaffCode(prisma, deps, fan, instanceId, '582917');
    assert.ok(r.ok, JSON.stringify(r));
    const instance = await owner.couponInstance.findUnique({ where: { id: instanceId } });
    assert.equal(instance?.status, 'REDEEMED');
    assert.equal(instance?.redeemMode, 'STAFF_CODE');
  });

  it('驗證碼錯誤', async () => {
    const { fan, instanceId } = await started();
    const r = await redeemWithStaffCode(prisma, deps, fan, instanceId, '111222');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'STAFF_CODE_MISMATCH');
    assert.equal(!r.ok && r.attemptsLeft, 4);
    assert.equal((await owner.couponInstance.findUnique({ where: { id: instanceId } }))?.status, 'CLAIMED');
  });

  it('錯誤達 5 次', async () => {
    const { fan, instanceId } = await started();
    for (let i = 0; i < 5; i++) await redeemWithStaffCode(prisma, deps, fan, instanceId, '111222');
    const r = await redeemWithStaffCode(prisma, deps, fan, instanceId, '582917');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'SESSION_REQUIRED');
  });

  it('時段結束', async () => {
    const { fan, instanceId } = await started();
    clock.now += 5 * 60 * 1000 + 1000;
    try {
      const r = await redeemWithStaffCode(prisma, deps, fan, instanceId, '582917');
      assert.equal(!r.ok && r.reason, 'SESSION_EXPIRED');
      assert.equal((await owner.couponInstance.findUnique({ where: { id: instanceId } }))?.status, 'CLAIMED');
    } finally {
      clock.now -= 5 * 60 * 1000 + 1000;
    }
  });

  it('沒有開始就送出驗證碼', async () => {
    const p = await person('沒開始', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    const r = await redeemWithStaffCode(prisma, deps, fan, instanceId, '582917');
    assert.equal(!r.ok && r.reason, 'SESSION_REQUIRED');
  });
});

describe('店員掃碼後顧客端得知核銷完成', () => {
  it('店員核銷後查詢', async () => {
    const p = await person('掃碼', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    // 模擬店員端核銷
    await owner.couponInstance.update({
      where: { id: instanceId },
      data: { status: 'REDEEMED', redeemedAt: new Date(), redeemMode: 'STAFF_SCAN' },
    });
    const view = await getWalletCoupon(prisma, fan, instanceId);
    assert.equal(view?.walletStatus, 'USED');
    assert.ok(view?.redeemedAt);
  });
});

describe('店員掃碼券的 QR Code 與驗證碼位數', () => {
  it('只有可使用的店員掃碼券能取得 QR Code', async () => {
    const scan = await withTenant(prisma, T, (tx) =>
      createCoupon(tx, T, agentId, {
        name: `${MARK} 掃碼券`, couponType: 'GIFT', giftName: '濾網', purpose: 'SERVICE', validityMode: 'AFTER_CLAIM',
        afterClaimDays: 30, codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_SCAN', perContactLimit: 5,
      }));
    await withTenant(prisma, T, (tx) => changeStatus(tx, T, scan.id, 'ACTIVE'));
    const p = await person('QR', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p, scan.id);
    const fan = await fanOf(p, token);
    const qr = await getWalletQrCode(prisma, fan, instanceId);
    assert.ok(qr.ok, JSON.stringify(qr));
    assert.ok(qr.ok && qr.dataUrl.startsWith('data:image/png;base64,'));

    await owner.couponInstance.update({ where: { id: instanceId }, data: { status: 'REDEEMED', redeemedAt: new Date() } });
    const used = await getWalletQrCode(prisma, fan, instanceId);
    assert.equal(used.ok, false);

    // 店員驗證碼券不是掃碼券
    const staff = await issue(p);
    const notScan = await getWalletQrCode(prisma, fan, staff.instanceId);
    assert.equal(!notScan.ok && notScan.reason, 'NOT_STAFF_SCAN');
  });

  it('驗證碼輸入格數', async () => {
    const p = await person('格數', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    const view = await getWalletCoupon(prisma, fan, instanceId);
    assert.equal(view?.coupon.staffCodeLength, 6);
    assert.ok(!JSON.stringify(view).includes('582917'), '顧客端不可拿到驗證碼本身');
  });
});

