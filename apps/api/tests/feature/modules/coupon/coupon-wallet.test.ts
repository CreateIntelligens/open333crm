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
import { signFanDeviceToken, verifyFanToken } from '#src/modules/portal/portal-auth.service.js';
import { requestOwnershipCode } from '#src/modules/identity-binding/ownership-code.js';
import { EMAIL_REGISTRATION } from '#src/modules/identity-binding/email-registration.service.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { issueInConversation, type InboxFlowDeps } from '#src/modules/coupon/coupon-inbox.flow.js';
import {
  openWalletSessionFlow,
  redeemWithStaffCodeFlow,
  startStaffCodeSessionFlow,
} from '#src/modules/coupon/coupon-wallet.flow.js';
import {
  listWallet,
  getWalletCoupon,
  getWalletQrCode,
  type WalletDeps,
} from '#src/modules/coupon/coupon-wallet.service.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';

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
const flowDeps = () => ({ ...deps, prisma, io: testIo });
// 對話發券：與票券夾共用同一個儲存與時鐘，測試不真的送訊息，記下送出的文字
const inboxDeps: InboxFlowDeps = {
  prisma,
  io: testIo,
  ...deps,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (params) => {
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
  const r = await issueInConversation(inboxDeps, {
    tenantId: T, couponId: id, conversationId: p.conversationId, agentId: issuer, agentName: '王小美',
    expectedAssigneeId: null, requestKey: randomUUID(),
  });
  assert.ok(r.ok, `發券失敗：${JSON.stringify(r)}`);
  const msg = delivered.filter((d) => d.conversationId === p.conversationId).at(-1)!;
  const token = /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
  assert.ok(token, '訊息內必須有票券連結');
  return { token, instanceId: r.instanceId };
}

/** 顧客在這台裝置驗證過（design D24）：已歸戶的顧客要帶裝置憑證才直接開啟 */
const deviceOf = (p: Person) => [signFanDeviceToken(p.contactId, T)];

async function fanOf(p: Person, token: string) {
  const s = await openWalletSessionFlow(flowDeps(), token, deviceOf(p));
  assert.equal(s.status, 'ok', `換憑證失敗：${JSON.stringify(s)}`);
  return s.status === 'ok' ? { tenantId: s.tenantId, contactId: s.contactId } : { tenantId: T, contactId: p.contactId };
}

beforeAll(async () => {
  const settings = await owner.tenantSettings.findUnique({ where: { tenantId: T }, select: { identityBinding: true } });
  originalSettings = settings?.identityBinding ?? {};
  await owner.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { phoneEnabled: true, emailEnabled: true } },
    update: { identityBinding: { phoneEnabled: true, emailEnabled: true } },
  });
  invalidateIdentityBindingSettings();
  const mk = (channelType: 'LINE' | 'FB') =>
    owner.channel.create({ data: { tenantId: T, channelType, displayName: `${MARK}-${channelType}`, credentialsEncrypted: 'x', isActive: true } });
  issuer = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '王小美', passwordHash: 'x' } })).id;
  lineChannel = (await mk('LINE')).id;
  fbChannel = (await mk('FB')).id;
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), agentId, {
      name: `${MARK} 店員驗證碼券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, minSpend: 1000, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'WAL',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 20,
    }));
  couponId = c.id;
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), couponId, 'ACTIVE'))).ok);
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
  it('已驗證的裝置開啟票券連結', async () => {
    const p = await person('已歸戶', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const s = await openWalletSessionFlow(flowDeps(), token, deviceOf(p));
    assert.equal(s.status, 'ok');
    if (s.status !== 'ok') return;
    assert.equal(s.instanceId, instanceId);
    const payload = verifyFanToken(s.fanToken);
    assert.equal(payload?.contactId, p.contactId);
    assert.equal(payload?.tenantId, T);
    const wallet = await runInTenant(prisma, T, (ctx) => listWallet(ctx, { tenantId: T, contactId: p.contactId }));
    assert.ok(wallet.items.some((i) => i.id === instanceId));
  });

  it('未歸戶的顧客開啟票券連結', async () => {
    const p = await person('未歸戶', lineChannel, 'LINE');
    const { token } = await issue(p);
    const s = await openWalletSessionFlow(flowDeps(), token);
    assert.equal(s.status, 'verification_required');
    if (s.status !== 'verification_required') return;
    assert.equal(s.kind, 'email');
    assert.match(s.registrationUrl, /^\/bind\/email\/[A-Za-z0-9_-]+\?next=/);
    assert.equal(new URL(s.registrationUrl, 'https://x').searchParams.get('next'), `/coupon/open/${token}`);
  });

  it('兩種登記都啟用時優先用 email', async () => {
    const p = await person('兩種都啟用', lineChannel, 'LINE');
    const { token } = await issue(p);
    await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: { phoneEnabled: true, emailEnabled: true } } });
    invalidateIdentityBindingSettings();
    try {
      const s = await openWalletSessionFlow(flowDeps(), token);
      assert.equal(s.status, 'verification_required');
      if (s.status !== 'verification_required') return;
      assert.equal(s.kind, 'email');
      assert.match(s.registrationUrl, /^\/bind\/email\/[A-Za-z0-9_-]+\?next=/);
    } finally {
      await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: { phoneEnabled: true, emailEnabled: true } } });
      invalidateIdentityBindingSettings();
    }
  });

  it('未驗證顧客重複開啟票券連結', async () => {
    const p = await person('重複開啟未驗證', lineChannel, 'LINE');
    const { token } = await issue(p);
    const urls = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const s = await openWalletSessionFlow(flowDeps(), token);
      assert.equal(s.status, 'verification_required', `第 ${i + 1} 次`);
      if (s.status === 'verification_required') urls.add(s.registrationUrl);
      clock.now += 60 * 1000;
    }
    clock.now -= 10 * 60 * 1000;
    assert.equal(urls.size, 1, '30 分鐘內都用同一個登記連結');
  });

  it('從 Facebook 開啟票券連結', async () => {
    const fb = await person('FB開啟', fbChannel, 'FB');
    const { token } = await issue(fb);
    const s = await openWalletSessionFlow(flowDeps(), token);
    assert.equal(s.status, 'verification_required');
    assert.equal((s as { channelType?: string }).channelType, 'FB');
    const line = await person('LINE開啟', lineChannel, 'LINE', { verified: true });
    const ok = await openWalletSessionFlow(flowDeps(), (await issue(line)).token, deviceOf(line));
    assert.equal((ok as { channelType?: string }).channelType, 'LINE');
  });

  it('未驗證的顧客開啟票券連結也記錄', async () => {
    const p = await person('開啟記錄', lineChannel, 'LINE');
    const { token, instanceId } = await issue(p);
    const first = clock.now;
    for (let i = 0; i < 3; i++) {
      await openWalletSessionFlow(flowDeps(), token);
      clock.now += 60_000;
    }
    clock.now -= 3 * 60_000;
    const row = await owner.couponInstance.findUnique({ where: { id: instanceId } });
    assert.equal(row?.linkOpenCount, 3);
    assert.equal(row?.linkOpenedAt?.getTime(), first);
  });

  it('客服手動填寫的手機不算歸戶', async () => {
    const p = await person('客服填手機', lineChannel, 'LINE', { phone: '0912000111' });
    const { token } = await issue(p);
    assert.equal((await openWalletSessionFlow(flowDeps(), token)).status, 'verification_required');
  });

  it('租戶沒有啟用任何登記方式', async () => {
    const p = await person('沒啟用', lineChannel, 'LINE');
    const { token } = await issue(p);
    await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: {} } });
    invalidateIdentityBindingSettings();
    try {
      assert.equal((await openWalletSessionFlow(flowDeps(), token)).status, 'unavailable');
    } finally {
      await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: { phoneEnabled: true, emailEnabled: true } } });
      invalidateIdentityBindingSettings();
    }
  });

  it('登記連結的驗證碼寄送次數用完後，重新開啟票券會換新連結', async () => {
    const p = await person('寄送用完', lineChannel, 'LINE');
    const { token } = await issue(p);
    const first = await openWalletSessionFlow(flowDeps(), token);
    assert.equal(first.status, 'verification_required');
    const regToken = /\/bind\/email\/([A-Za-z0-9_-]+)/.exec((first as { registrationUrl: string }).registrationUrl)![1];
    const send = async () => undefined;
    for (let i = 0; i < 3; i++) {
      assert.equal((await requestOwnershipCode(EMAIL_REGISTRATION, { store: deps.store, sendCode: send }, regToken, 'a@example.com')).status, 'code_sent');
    }
    const again = await openWalletSessionFlow(flowDeps(), token);
    assert.ok(!(again as { registrationUrl: string }).registrationUrl.includes(regToken), '應該換一個新的登記連結');
  });

  it('租戶只啟用手機登記', async () => {
    const p = await person('只有手機', lineChannel, 'LINE');
    const { token } = await issue(p);
    await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: { phoneEnabled: true } } });
    invalidateIdentityBindingSettings();
    try {
      assert.equal((await openWalletSessionFlow(flowDeps(), token)).status, 'unavailable');
    } finally {
      await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: { phoneEnabled: true, emailEnabled: true } } });
      invalidateIdentityBindingSettings();
    }
  });
});

describe('票券連結', () => {
  it('開啟有效連結', async () => {
    const p = await person('重複開啟', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    await openWalletSessionFlow(flowDeps(), token, deviceOf(p));
    clock.now += 6 * DAY;
    try {
      const again = await openWalletSessionFlow(flowDeps(), token, deviceOf(p));
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
      assert.equal((await openWalletSessionFlow(flowDeps(), token)).status, 'expired');
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
    const s = await openWalletSessionFlow(flowDeps(), token, deviceOf(line));
    assert.equal(s.status, 'ok');
    assert.equal(s.status === 'ok' && s.contactId, line.contactId);
  });

  it('只能存取自己的券', async () => {
    const a = await person('甲', lineChannel, 'LINE', { verified: true });
    const b = await person('乙', lineChannel, 'LINE', { verified: true });
    const { instanceId } = await issue(b);
    assert.equal(await runInTenant(prisma, T, (ctx) => getWalletCoupon(ctx, { tenantId: T, contactId: a.contactId }, instanceId)), null);
    // 其他租戶的顧客憑證也拿不到
    assert.equal(await runInTenant(prisma, TENANT_B, (ctx) => getWalletCoupon(ctx, { tenantId: TENANT_B, contactId: b.contactId }, instanceId)), null);
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
    const wallet = await runInTenant(prisma, fan.tenantId, (ctx) => listWallet(ctx, fan, clock.now));
    assert.deepEqual(wallet.counts, { available: 2, used: 1, invalid: 1 });
    assert.equal(wallet.items.find((i) => i.id === expired.instanceId)?.walletStatus, 'EXPIRED');
  });

  it('活動提前結束的券註明原因', async () => {
    const c = await withTenant(prisma, T, (tx) =>
      createCoupon(ctxOf(tx, T), agentId, {
        name: `${MARK} 會提前結束`, couponType: 'GIFT', giftName: '濾網', purpose: 'SERVICE', validityMode: 'AFTER_CLAIM',
        afterClaimDays: 30, codeMode: 'UNIQUE_CODE', redeemMode: 'SELF',
      }));
    await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'));
    const p = await person('提前結束', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p, c.id);
    const fan = await fanOf(p, token);
    await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ENDED'));
    const view = await runInTenant(prisma, fan.tenantId, (ctx) => getWalletCoupon(ctx, fan, instanceId));
    assert.equal(view?.walletStatus, 'ENDED');
  });
});

describe('店員驗證碼核銷須在時限內完成', () => {
  async function started() {
    const p = await person(`核銷-${randomUUID().slice(0, 6)}`, lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    const s = await startStaffCodeSessionFlow(flowDeps(), fan, instanceId);
    assert.ok(s.ok, `開始使用失敗：${JSON.stringify(s)}`);
    // 回傳以伺服器時間算的剩餘毫秒：顧客手機時鐘不準時倒數也正確
    assert.equal(s.ok && s.remainingMs, 5 * 60 * 1000);
    return { fan, instanceId };
  }

  it('時段內輸入正確驗證碼', async () => {
    const { fan, instanceId } = await started();
    const r = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '582917');
    assert.ok(r.ok, JSON.stringify(r));
    const instance = await owner.couponInstance.findUnique({ where: { id: instanceId } });
    assert.equal(instance?.status, 'REDEEMED');
    assert.equal(instance?.redeemMode, 'STAFF_CODE');
  });

  it('驗證碼錯誤', async () => {
    const { fan, instanceId } = await started();
    const r = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '111222');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'STAFF_CODE_MISMATCH');
    assert.equal(!r.ok && r.attemptsLeft, 4);
    assert.equal((await owner.couponInstance.findUnique({ where: { id: instanceId } }))?.status, 'CLAIMED');
  });

  it('錯誤達 5 次', async () => {
    const { fan, instanceId } = await started();
    for (let i = 0; i < 5; i++) await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '111222');
    const r = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '582917');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'SESSION_REQUIRED');
  });

  it('時段結束', async () => {
    const { fan, instanceId } = await started();
    clock.now += 5 * 60 * 1000 + 1000;
    try {
      const r = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '582917');
      assert.equal(!r.ok && r.reason, 'SESSION_EXPIRED');
      assert.equal((await owner.couponInstance.findUnique({ where: { id: instanceId } }))?.status, 'CLAIMED');
    } finally {
      clock.now -= 5 * 60 * 1000 + 1000;
    }
  });

  it('同一位顧客持有同一張券的多張，錯誤次數合併計算', async () => {
    const p = await person(`多張-${randomUUID().slice(0, 6)}`, lineChannel, 'LINE', { verified: true });
    const first = await issue(p);
    const second = await issue(p);
    const fan = await fanOf(p, first.token);
    for (const round of [0, 1]) {
      assert.ok((await startStaffCodeSessionFlow(flowDeps(), fan, first.instanceId)).ok, `第 ${round + 1} 輪開始`);
      for (let i = 0; i < 5; i++) await redeemWithStaffCodeFlow(flowDeps(), fan, first.instanceId, '111222');
    }
    // 換另一張同樣的券也不能再試：驗證碼是整張券共用的
    const other = await startStaffCodeSessionFlow(flowDeps(), fan, second.instanceId);
    assert.equal(!other.ok && other.reason, 'TOO_MANY_ATTEMPTS');
  });

  it('一天內錯誤累計達 10 次就不能再核銷，重新開始也一樣', async () => {
    const { fan, instanceId } = await started();
    for (let i = 0; i < 5; i++) await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '111222');
    const again = await startStaffCodeSessionFlow(flowDeps(), fan, instanceId);
    assert.ok(again.ok, '錯誤 5 次後可以重新開始');
    for (let i = 0; i < 5; i++) await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '111222');
    const third = await startStaffCodeSessionFlow(flowDeps(), fan, instanceId);
    assert.equal(!third.ok && third.reason, 'TOO_MANY_ATTEMPTS');
    const r = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '582917');
    assert.equal(!r.ok && r.reason, 'TOO_MANY_ATTEMPTS');
    assert.equal((await owner.couponInstance.findUnique({ where: { id: instanceId } }))?.status, 'CLAIMED');
    // 24 小時後解除
    clock.now += 24 * 60 * 60 * 1000 + 1000;
    try {
      const later = await startStaffCodeSessionFlow(flowDeps(), fan, instanceId);
      assert.ok(later.ok, JSON.stringify(later));
    } finally {
      clock.now -= 24 * 60 * 60 * 1000 + 1000;
    }
  });

  it('同時送出多個驗證碼也都計入錯誤次數', async () => {
    const { fan, instanceId } = await started();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, String(100000 + i))),
    );
    const reasons = results.map((r) => (r.ok ? 'OK' : r.reason));
    // 先佔用次數再比對：恰好 5 個請求比對驗證碼，其餘因時段次數用完而要求重新開始
    assert.equal(reasons.filter((r) => r === 'STAFF_CODE_MISMATCH').length, 5, reasons.join(','));
    assert.equal(reasons.filter((r) => r === 'SESSION_REQUIRED').length, 3, reasons.join(','));
    // 時段已關閉：再送一次（即使是正確的碼）也不會核銷
    const after = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '582917');
    assert.deepEqual(after, { ok: false, reason: 'SESSION_REQUIRED' });
  });

  it('沒有開始就送出驗證碼', async () => {
    const p = await person('沒開始', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    const r = await redeemWithStaffCodeFlow(flowDeps(), fan, instanceId, '582917');
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
    const view = await runInTenant(prisma, fan.tenantId, (ctx) => getWalletCoupon(ctx, fan, instanceId));
    assert.equal(view?.walletStatus, 'USED');
    assert.ok(view?.redeemedAt);
  });
});

describe('店員掃碼券的 QR Code 與驗證碼位數', () => {
  it('只有可使用的店員掃碼券能取得 QR Code', async () => {
    const scan = await withTenant(prisma, T, (tx) =>
      createCoupon(ctxOf(tx, T), agentId, {
        name: `${MARK} 掃碼券`, couponType: 'GIFT', giftName: '濾網', purpose: 'SERVICE', validityMode: 'AFTER_CLAIM',
        afterClaimDays: 30, codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_SCAN', perContactLimit: 5,
      }));
    await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), scan.id, 'ACTIVE'));
    const p = await person('QR', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p, scan.id);
    const fan = await fanOf(p, token);
    const qr = await runInTenant(prisma, fan.tenantId, (ctx) => getWalletQrCode(ctx, fan, instanceId));
    assert.ok(qr.ok, JSON.stringify(qr));
    assert.ok(qr.ok && qr.dataUrl.startsWith('data:image/png;base64,'));

    await owner.couponInstance.update({ where: { id: instanceId }, data: { status: 'REDEEMED', redeemedAt: new Date() } });
    const used = await runInTenant(prisma, fan.tenantId, (ctx) => getWalletQrCode(ctx, fan, instanceId));
    assert.equal(used.ok, false);

    // 店員驗證碼券不是掃碼券
    const staff = await issue(p);
    const notScan = await runInTenant(prisma, fan.tenantId, (ctx) => getWalletQrCode(ctx, fan, staff.instanceId));
    assert.equal(!notScan.ok && notScan.reason, 'NOT_STAFF_SCAN');
  });

  it('驗證碼輸入格數', async () => {
    const p = await person('格數', lineChannel, 'LINE', { verified: true });
    const { token, instanceId } = await issue(p);
    const fan = await fanOf(p, token);
    const view = await runInTenant(prisma, fan.tenantId, (ctx) => getWalletCoupon(ctx, fan, instanceId));
    assert.equal(view?.coupon.staffCodeLength, 6);
    assert.ok(!JSON.stringify(view).includes('582917'), '顧客端不可拿到驗證碼本身');
  });
});

