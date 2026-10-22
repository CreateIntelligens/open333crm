/**
 * 票券連結要在已驗證的裝置開啟，或以原 email 驗證碼確認身分（add-coupon-system design D24；
 * spec coupon-redemption「顧客須完成歸戶驗證才能開啟票券夾」）。
 *
 * 2026-10-22 UAT 實測：同一位顧客先用 LINE 驗證後，Messenger 的券連結點開就直接進去——
 * 已歸戶顧客的任何票券連結都等同登入憑證，被轉傳後別人不用驗證就能打開票券夾。
 *
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線，以 MARK 標記，afterAll 刪除。
 * 票券連結與驗證碼用記憶體儲存（時間可快轉），寄信以注入函式取代。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest';

// 驗證碼由 randomInt(0, 1_000_000) 產生；排入的值依序取用，讓「重寄後舊碼失效」不會因兩組碼碰巧相同而漏測
const nextCodes = vi.hoisted(() => [] as number[]);
vi.mock('node:crypto', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:crypto')>();
  const randomInt = ((min: number, max?: number) =>
    min === 0 && max === 1_000_000 && nextCodes.length > 0 ? nextCodes.shift()! : (mod.randomInt as (a: number, b?: number) => number)(min, max)) as typeof mod.randomInt;
  return { ...mod, default: { ...mod, randomInt }, randomInt };
});
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { signFanDeviceToken, signFanToken, verifyFanDeviceToken, verifyFanToken } from '#src/modules/portal/portal-auth.service.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { issueInConversation, type InboxFlowDeps } from '#src/modules/coupon/coupon-inbox.flow.js';
import {
  openWalletSessionFlow,
  requestWalletEmailCodeFlow,
  verifyWalletEmailCodeFlow,
  type WalletFlowDeps,
} from '#src/modules/coupon/coupon-wallet.flow.js';
import { ctxOf, testIo } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-device-${Date.now()}`;
const creatorId = randomUUID();
let issuer = '';
const MIN = 60 * 1000;

const clock = { now: Date.now() };
const store = memBindingStore(clock);
const mails: Array<{ to: string; code: string; senderName: string }> = [];
const flowDeps: WalletFlowDeps = {
  store,
  now: () => clock.now,
  prisma,
  io: testIo,
  sendEmailCode: async (to, code, senderName) => {
    mails.push({ to, code, senderName });
  },
};
const delivered: Array<{ conversationId: string; text: string }> = [];
const inboxDeps: InboxFlowDeps = {
  prisma,
  io: testIo,
  store,
  now: () => clock.now,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (params) => {
    delivered.push(params);
    return { sent: true };
  },
};

let originalSettings: unknown = null;
let lineChannel = '';
let fbChannel = '';
let couponId = '';

interface Person {
  contactId: string;
  conversationId: string;
}

async function person(
  name: string,
  channelId: string,
  channelType: 'LINE' | 'FB',
  opts: { verified?: boolean; email?: string | null } = {},
): Promise<Person> {
  const contact = await owner.contact.create({
    data: {
      tenantId: T,
      displayName: `${MARK}-${name}`,
      email: opts.email ?? null,
      ...(opts.verified ? { identityVerifiedAt: new Date(), identityVerifiedVia: 'email' } : {}),
    },
  });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId, channelType, uid: `${MARK}-${name}`, profileName: name },
  });
  const conv = await owner.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId, channelType } });
  return { contactId: contact.id, conversationId: conv.id };
}

async function issue(p: Person): Promise<{ token: string; instanceId: string }> {
  const r = await issueInConversation(inboxDeps, {
    tenantId: T, couponId, conversationId: p.conversationId, agentId: issuer, agentName: '王小美',
    expectedAssigneeId: null, requestKey: randomUUID(),
  });
  assert.ok(r.ok, `發券失敗：${JSON.stringify(r)}`);
  const msg = delivered.filter((d) => d.conversationId === p.conversationId).at(-1)!;
  const token = /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
  assert.ok(token, '訊息內必須有票券連結');
  return { token, instanceId: r.instanceId };
}

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

beforeAll(async () => {
  const settings = await owner.tenantSettings.findUnique({ where: { tenantId: T }, select: { identityBinding: true } });
  originalSettings = settings?.identityBinding ?? {};
  await owner.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { emailEnabled: true } },
    update: { identityBinding: { emailEnabled: true } },
  });
  invalidateIdentityBindingSettings();
  const mk = (channelType: 'LINE' | 'FB') =>
    owner.channel.create({ data: { tenantId: T, channelType, displayName: `${MARK}-${channelType}`, credentialsEncrypted: 'x', isActive: true } });
  issuer = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '王小美', passwordHash: 'x' } })).id;
  lineChannel = (await mk('LINE')).id;
  fbChannel = (await mk('FB')).id;
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} 券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'DEV',
      redeemMode: 'SELF', perContactLimit: 50,
    } as never));
  couponId = c.id;
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), couponId, 'ACTIVE'))).ok);
});

beforeEach(() => {
  mails.length = 0;
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.message.deleteMany({ where: { conversation: { tenantId: T, contact: contacts } } });
  await owner.conversation.deleteMany({ where: { tenantId: T, contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.channel.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { tenantId: T, email: `${MARK}@example.com` } });
  await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: originalSettings as object } });
  invalidateIdentityBindingSettings();
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('顧客須完成歸戶驗證才能開啟票券夾：已驗證的裝置', () => {
  it('已驗證的裝置開啟票券連結', async () => {
    const p = await person('已驗證裝置', lineChannel, 'LINE', { verified: true, email: 'dan@aicreate360.com' });
    const { token, instanceId } = await issue(p);
    const device = signFanDeviceToken(p.contactId, T);
    const s = await openWalletSessionFlow(flowDeps, token, [device]);
    assert.equal(s.status, 'ok', JSON.stringify(s));
    if (s.status !== 'ok') return;
    assert.equal(s.instanceId, instanceId);
    assert.equal(verifyFanToken(s.fanToken)?.contactId, p.contactId);
    // 回傳換新的裝置憑證（延長效期），仍屬於同一位顧客與租戶
    assert.deepEqual(verifyFanDeviceToken(s.deviceToken), { contactId: p.contactId, tenantId: T });
    assert.equal(mails.length, 0, '已驗證的裝置不寄驗證碼');
  });

  it('同一台裝置存了多個租戶的裝置憑證，其中一個符合就能開啟', async () => {
    const p = await person('多筆裝置憑證', lineChannel, 'LINE', { verified: true, email: 'multi@example.com' });
    const { token } = await issue(p);
    const s = await openWalletSessionFlow(flowDeps, token, [
      signFanDeviceToken(randomUUID(), TENANT_B),
      'not-a-jwt',
      signFanDeviceToken(p.contactId, T),
    ]);
    assert.equal(s.status, 'ok', JSON.stringify(s));
  });

  it('聯絡人合併後，合併前取得的裝置憑證仍有效', async () => {
    const fb = await person('合併前FB', fbChannel, 'FB', { verified: true, email: 'merge-device@example.com' });
    const line = await person('合併後LINE', lineChannel, 'LINE', { verified: true, email: 'merge-device@example.com' });
    const deviceOfFb = signFanDeviceToken(fb.contactId, T);
    const { token, instanceId } = await issue(line);
    // 以 owner 模擬合併：FB 聯絡人併入 LINE 聯絡人
    await owner.contact.update({ where: { id: fb.contactId }, data: { isArchived: true, mergedIntoId: line.contactId } });
    const s = await openWalletSessionFlow(flowDeps, token, [deviceOfFb]);
    assert.equal(s.status, 'ok', JSON.stringify(s));
    assert.equal(s.status === 'ok' && s.contactId, line.contactId);
    assert.equal(s.status === 'ok' && s.instanceId, instanceId);
    // 換新的裝置憑證直接屬於保留方
    assert.equal(s.status === 'ok' && verifyFanDeviceToken(s.deviceToken)?.contactId, line.contactId);
  });
});

describe('顧客須完成歸戶驗證才能開啟票券夾：新裝置或轉傳的連結', () => {
  it('新裝置或轉傳的連結開啟已歸戶顧客的票券', async () => {
    // 先用 LINE 驗證過的顧客，Messenger 收到的券連結被轉傳出去
    const p = await person('轉傳', fbChannel, 'FB', { verified: true, email: 'dan@aicreate360.com' });
    const { token, instanceId } = await issue(p);
    const s = await openWalletSessionFlow(flowDeps, token);
    assert.equal(s.status, 'email_code_required', JSON.stringify(s));
    assert.equal((s as { maskedEmail?: string }).maskedEmail, 'd***@aicreate360.com');
    assert.equal((s as { channelType?: string }).channelType, 'FB');
    assert.equal((s as { fanToken?: string }).fanToken, undefined, '不回傳顧客憑證');
    assert.equal((s as { registrationUrl?: string }).registrationUrl, undefined, '不給輸入其他 email 的機會');
    const row = await owner.couponInstance.findUnique({ where: { id: instanceId } });
    assert.equal(row?.viewedAt, null, '沒有確認身分前不算顧客已領取');
    assert.equal(row?.linkOpenCount, 1, '開啟次數照常記錄');
  });

  for (const [name, device] of [
    ['其他聯絡人的裝置憑證', () => signFanDeviceToken(randomUUID(), T)],
    ['其他租戶的裝置憑證', (p: Person) => signFanDeviceToken(p.contactId, TENANT_B)],
    ['顧客憑證不能當裝置憑證', (p: Person) => signFanToken(p.contactId, T)],
    ['竄改過的裝置憑證', (p: Person) => `${signFanDeviceToken(p.contactId, T)}x`],
  ] as const) {
    it(`${name}不算已驗證的裝置`, async () => {
      const p = await person(name, lineChannel, 'LINE', { verified: true, email: 'other@example.com' });
      const { token } = await issue(p);
      const s = await openWalletSessionFlow(flowDeps, token, [device(p)]);
      assert.equal(s.status, 'email_code_required', JSON.stringify(s));
    });
  }

  it('裝置憑證不能當顧客憑證使用', async () => {
    const id = randomUUID();
    assert.equal(verifyFanToken(signFanDeviceToken(id, T)), null);
  });

  it('沒有 email 的已歸戶顧客走登記', async () => {
    // 只用 LINE 驗證過、沒有 email：維持現有的 email 登記流程（殘留風險見 issue #344）
    const p = await person('沒有email', fbChannel, 'FB', { verified: true, email: null });
    const { token } = await issue(p);
    const s = await openWalletSessionFlow(flowDeps, token);
    assert.equal(s.status, 'verification_required', JSON.stringify(s));
    assert.match((s as { registrationUrl: string }).registrationUrl, /^\/bind\/email\/[A-Za-z0-9_-]+\?next=/);
  });
});

describe('以原 email 驗證碼確認身分', () => {
  it('寄驗證碼到聯絡人原本的 email，輸入正確後開啟並記住裝置', async () => {
    const p = await person('寄碼', fbChannel, 'FB', { verified: true, email: 'amy@example.com' });
    const { token, instanceId } = await issue(p);
    const sent = await requestWalletEmailCodeFlow(flowDeps, token);
    assert.deepEqual(sent, { status: 'code_sent', maskedEmail: 'a***@example.com' });
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'amy@example.com', '只寄到聯絡人既有的 email');
    assert.match(mails[0].code, /^\d{6}$/);

    const v = await verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code);
    assert.equal(v.status, 'ok', JSON.stringify(v));
    if (v.status !== 'ok') return;
    assert.equal(v.instanceId, instanceId);
    assert.equal(v.contactId, p.contactId);
    assert.equal(v.tenantId, T);
    assert.equal(v.channelType, 'FB');
    assert.equal(verifyFanToken(v.fanToken)?.contactId, p.contactId);
    assert.deepEqual(verifyFanDeviceToken(v.deviceToken), { contactId: p.contactId, tenantId: T });
    const row = await owner.couponInstance.findUnique({ where: { id: instanceId } });
    assert.ok(row?.viewedAt, '確認身分後記為已領取');

    // 驗證碼用過就失效
    assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code)).status, 'code_expired');
    // 之後在同一台裝置開啟不必再驗證
    assert.equal((await openWalletSessionFlow(flowDeps, token, [v.deviceToken])).status, 'ok');
  });

  it('驗證碼錯誤', async () => {
    const p = await person('驗證碼錯誤', fbChannel, 'FB', { verified: true, email: 'wrong@example.com' });
    const { token } = await issue(p);
    await requestWalletEmailCodeFlow(flowDeps, token);
    const v = await verifyWalletEmailCodeFlow(flowDeps, token, wrongCode(mails[0].code));
    assert.deepEqual(v, { status: 'invalid_code', remainingAttempts: 4 });
  });

  it('同一組驗證碼錯 5 次後作廢，要重寄', async () => {
    const p = await person('錯五次', fbChannel, 'FB', { verified: true, email: 'locked@example.com' });
    const { token } = await issue(p);
    await requestWalletEmailCodeFlow(flowDeps, token);
    for (let i = 0; i < 5; i++) {
      assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, wrongCode(mails[0].code))).status, 'invalid_code');
    }
    assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code)).status, 'locked');
    // 重寄後的新驗證碼可以用
    assert.equal((await requestWalletEmailCodeFlow(flowDeps, token)).status, 'code_sent');
    assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, mails[1].code)).status, 'ok');
  });

  it('驗證碼 10 分鐘後過期', async () => {
    const p = await person('驗證碼過期', fbChannel, 'FB', { verified: true, email: 'expire@example.com' });
    const { token } = await issue(p);
    await requestWalletEmailCodeFlow(flowDeps, token);
    clock.now += 11 * MIN;
    try {
      assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code)).status, 'code_expired');
    } finally {
      clock.now -= 11 * MIN;
    }
  });

  it('同一個票券連結 10 分鐘內最多寄 3 次', async () => {
    const p = await person('寄送上限', fbChannel, 'FB', { verified: true, email: 'limit@example.com' });
    const { token } = await issue(p);
    for (let i = 0; i < 3; i++) assert.equal((await requestWalletEmailCodeFlow(flowDeps, token)).status, 'code_sent');
    assert.equal((await requestWalletEmailCodeFlow(flowDeps, token)).status, 'too_many_codes');
    assert.equal(mails.length, 3);
    clock.now += 11 * MIN;
    try {
      assert.equal((await requestWalletEmailCodeFlow(flowDeps, token)).status, 'code_sent', '10 分鐘後可以再寄');
    } finally {
      clock.now -= 11 * MIN;
    }
  });

  it('重寄後舊的驗證碼不能用', async () => {
    const p = await person('重寄', fbChannel, 'FB', { verified: true, email: 'resend@example.com' });
    const { token } = await issue(p);
    nextCodes.push(111111, 222222);
    await requestWalletEmailCodeFlow(flowDeps, token);
    await requestWalletEmailCodeFlow(flowDeps, token);
    assert.deepEqual([mails[0].code, mails[1].code], ['111111', '222222']);
    assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code)).status, 'invalid_code');
    assert.equal((await verifyWalletEmailCodeFlow(flowDeps, token, mails[1].code)).status, 'ok');
  });

  it('同一組驗證碼同時送出兩次，只有一次成功（驗證碼只能用一次）', async () => {
    const p = await person('並行驗證', fbChannel, 'FB', { verified: true, email: 'race@example.com' });
    const { token } = await issue(p);
    await requestWalletEmailCodeFlow(flowDeps, token);
    const results = await Promise.all([
      verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code),
      verifyWalletEmailCodeFlow(flowDeps, token, mails[0].code),
    ]);
    assert.equal(results.filter((r) => r.status === 'ok').length, 1);
  });

  it('寄信失敗', async () => {
    const p = await person('寄信失敗', fbChannel, 'FB', { verified: true, email: 'fail@example.com' });
    const { token } = await issue(p);
    const failing: WalletFlowDeps = { ...flowDeps, sendEmailCode: async () => { throw new Error('SMTP 逾時'); } };
    assert.equal((await requestWalletEmailCodeFlow(failing, token)).status, 'send_failed');
    // 寄信失敗不計入寄送次數
    for (let i = 0; i < 3; i++) assert.equal((await requestWalletEmailCodeFlow(flowDeps, token)).status, 'code_sent');
  });

  it('未歸戶或沒有 email 的聯絡人不能要求寄驗證碼', async () => {
    const unverified = await person('未歸戶寄碼', fbChannel, 'FB', { email: 'nope@example.com' });
    assert.equal((await requestWalletEmailCodeFlow(flowDeps, (await issue(unverified)).token)).status, 'unavailable');
    const noEmail = await person('沒email寄碼', fbChannel, 'FB', { verified: true });
    assert.equal((await requestWalletEmailCodeFlow(flowDeps, (await issue(noEmail)).token)).status, 'unavailable');
    assert.equal(mails.length, 0);
  });

  it('票券連結不存在或過期', async () => {
    const bad = 'A'.repeat(43);
    assert.equal((await requestWalletEmailCodeFlow(flowDeps, bad)).status, 'expired');
    assert.equal((await verifyWalletEmailCodeFlow(flowDeps, bad, '123456')).status, 'expired');
    assert.equal(mails.length, 0);
  });
});
