/**
 * LINE 顧客以 LINE Login 驗證身分（add-coupon-system design D20；spec coupon-redemption
 * 「LINE 顧客以 LINE Login 驗證身分」）。LINE 的 ID token 驗證以替身取代，不呼叫 LINE API。
 *
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線，以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueInConversation, type InboxIssueDeps } from '#src/modules/coupon/coupon-inbox.service.js';
import { openWalletSession, openWalletSessionWithLine, type LineLoginDeps } from '#src/modules/coupon/coupon-wallet.service.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-line-${Date.now()}`;
const creatorId = randomUUID();
let agentId = '';
const LIFF_ID = '1660000000-AbCdEfGh';
const LOGIN_CHANNEL_ID = '1660000001';

/** 替身：idToken 為 `valid:{clientId}:{sub}` 時視為 LINE 驗證通過，client_id 必須相符 */
const verifyCalls: Array<{ idToken: string; clientId: string }> = [];
const deps: LineLoginDeps = {
  store: memBindingStore(),
  verifyLineIdToken: async (idToken, clientId) => {
    verifyCalls.push({ idToken, clientId });
    const [kind, aud, sub] = idToken.split(':');
    return kind === 'valid' && aud === clientId ? { sub } : null;
  },
};
const delivered: Array<{ conversationId: string; text: string }> = [];
const inboxDeps: InboxIssueDeps = {
  store: deps.store,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (_db, params) => {
    delivered.push(params);
    return { sent: true };
  },
};

let originalSettings: unknown = null;
let liffChannel = '';
let plainChannel = '';
let couponId = '';

async function person(name: string, channelId: string) {
  const uid = `U${MARK}-${name}`;
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-${name}` } });
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId, channelType: 'LINE', uid, profileName: name } });
  const conv = await owner.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId, channelType: 'LINE' } });
  return { contactId: contact.id, conversationId: conv.id, uid };
}

async function issue(p: { conversationId: string }) {
  const r = await issueInConversation(prisma, inboxDeps, {
    tenantId: T, couponId, conversationId: p.conversationId, agentId, agentName: '王小美',
    expectedAssigneeId: null, requestKey: randomUUID(),
  });
  assert.ok(r.ok, JSON.stringify(r));
  return delivered.filter((d) => d.conversationId === p.conversationId).at(-1)!.text;
}

const tokenOf = (text: string) =>
  /[?&]ct=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec(text)![1];

beforeAll(async () => {
  const settings = await owner.tenantSettings.findUnique({ where: { tenantId: T }, select: { identityBinding: true } });
  originalSettings = settings?.identityBinding ?? {};
  await owner.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { emailEnabled: true } },
    update: { identityBinding: { emailEnabled: true } },
  });
  invalidateIdentityBindingSettings();
  agentId = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '王小美', passwordHash: 'x' } })).id;
  liffChannel = (await owner.channel.create({
    data: {
      tenantId: T, channelType: 'LINE', displayName: `${MARK}-liff`, credentialsEncrypted: 'x', isActive: true,
      settings: { liffConfig: { liffId: LIFF_ID, loginChannelId: LOGIN_CHANNEL_ID } },
    },
  })).id;
  plainChannel = (await owner.channel.create({
    data: {
      tenantId: T, channelType: 'LINE', displayName: `${MARK}-plain`, credentialsEncrypted: 'x', isActive: true,
      settings: { liffConfig: { liffId: LIFF_ID } },
    },
  })).id;
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(tx, T, creatorId, {
      name: `${MARK} 券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'LIN',
      redeemMode: 'STAFF_SCAN', perContactLimit: 20,
    } as never));
  couponId = c.id;
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(tx, T, couponId, 'ACTIVE'))).ok);
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.message.deleteMany({ where: { conversation: { tenantId: T, contact: contacts } } });
  await owner.conversation.deleteMany({ where: { tenantId: T, contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.channel.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { id: agentId } });
  await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: originalSettings as object } });
  invalidateIdentityBindingSettings();
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('LINE 顧客以 LINE Login 驗證身分', () => {
  it('設定後發券連結改為 LIFF 網址', async () => {
    const p = await person('連結', liffChannel);
    const text = await issue(p);
    const token = tokenOf(text);
    assert.ok(text.includes(`https://liff.line.me/${LIFF_ID}?ct=${token}&lid=${LIFF_ID}`), text);
  });

  it('LINE 顧客從 LIFF 開啟票券連結', async () => {
    const p = await person('驗證', liffChannel);
    const token = tokenOf(await issue(p));
    const r = await openWalletSessionWithLine(prisma, deps, token, `valid:${LOGIN_CHANNEL_ID}:${p.uid}`);
    assert.equal(r.status, 'verified', JSON.stringify(r));
    assert.deepEqual(verifyCalls.at(-1), { idToken: `valid:${LOGIN_CHANNEL_ID}:${p.uid}`, clientId: LOGIN_CHANNEL_ID });
    const contact = await owner.contact.findUnique({ where: { id: p.contactId } });
    assert.ok(contact?.identityVerifiedAt);
    assert.equal(contact?.identityVerifiedVia, 'line');
    // 之後照一般流程開啟，不再要求登記
    assert.equal((await openWalletSession(prisma, deps, token)).status, 'ok');
  });

  it('ID token 驗證失敗', async () => {
    const p = await person('失敗', liffChannel);
    const token = tokenOf(await issue(p));
    // 其他 Login channel 簽發的 token：client_id 不符
    const r = await openWalletSessionWithLine(prisma, deps, token, `valid:9999999999:${p.uid}`);
    assert.equal(r.status, 'verification_failed');
    assert.equal((await owner.contact.findUnique({ where: { id: p.contactId } }))?.identityVerifiedAt, null);
  });

  it('用其他 LINE 帳號開啟轉傳的連結', async () => {
    const p = await person('收券者', liffChannel);
    const other = await person('轉傳對象', liffChannel);
    const token = tokenOf(await issue(p));
    const r = await openWalletSessionWithLine(prisma, deps, token, `valid:${LOGIN_CHANNEL_ID}:${other.uid}`);
    assert.equal(r.status, 'account_mismatch');
    assert.equal((r as { fanToken?: string }).fanToken, undefined);
    assert.equal((await owner.contact.findUnique({ where: { id: p.contactId } }))?.identityVerifiedAt, null);
    assert.equal((await owner.contact.findUnique({ where: { id: other.contactId } }))?.identityVerifiedAt, null);
  });

  it('渠道沒有設定 Login Channel ID', async () => {
    const p = await person('未設定', plainChannel);
    const text = await issue(p);
    assert.ok(text.includes('https://crm.example.com/coupon/open/'), '維持一般網址');
    const before = verifyCalls.length;
    const r = await openWalletSessionWithLine(prisma, deps, tokenOf(text), `valid:${LOGIN_CHANNEL_ID}:${p.uid}`);
    assert.equal(r.status, 'not_configured');
    assert.equal(verifyCalls.length, before, '沒有設定就不呼叫 LINE');
  });

  it('連結已失效', async () => {
    const r = await openWalletSessionWithLine(prisma, deps, 'A'.repeat(43), `valid:${LOGIN_CHANNEL_ID}:x`);
    assert.equal(r.status, 'expired');
  });
});
