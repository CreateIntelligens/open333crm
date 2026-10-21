/**
 * 對話發券（add-coupon-system A11、design D14）：發券面板資料、發券、發送鍵、
 * 回覆期限、對話範圍、兩位座席同時發券、聯絡人已發券。
 *
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線。
 * 發送鍵與票券連結用記憶體儲存，訊息送出以替身記錄，不碰渠道 API。
 * 本檔建立的券以 createdById 標記，聯絡人、渠道、座席以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { openWalletSession } from '#src/modules/coupon/coupon-wallet.service.js';
import {
  getIssueContext,
  getIssueRequest,
  issueInConversation,
  listIssuedCoupons,
  type InboxIssueDeps,
  type InboxIssueInput,
} from '#src/modules/coupon/coupon-inbox.service.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-inbox-${Date.now()}`;
const creatorId = randomUUID();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const clock = { now: Date.now() };
const delivered: Array<{ conversationId: string; text: string }> = [];
/** 這些對話的訊息送不出（模擬顧客封鎖） */
const unreachable = new Set<string>();
/** 送出訊息前等待的毫秒數，讓兩個發券請求重疊 */
let deliverDelayMs = 0;

const deps: InboxIssueDeps = {
  store: memBindingStore(clock),
  now: () => clock.now,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (_tx, params) => {
    if (deliverDelayMs) await new Promise((r) => setTimeout(r, deliverDelayMs));
    if (unreachable.has(params.conversationId)) return { sent: false, reason: 'blocked' };
    delivered.push(params);
    return { sent: true };
  },
  windowHoursFor: (channelType) => (channelType === 'FB' ? 24 : undefined),
};

let lineChannel = '';
let fbChannel = '';
let agentA = { id: '', name: '' };
let agentB = { id: '', name: '' };
const coupons = { amount: '', minSpend: '', expiring: '', limitOne: '', marketing: '', paused: '' };

interface Person {
  contactId: string;
  conversationId: string;
}

async function person(name: string, channelId = lineChannel, channelType: 'LINE' | 'FB' = 'LINE', opts: { verified?: boolean } = {}) {
  const contact = await owner.contact.create({
    data: {
      tenantId: T,
      displayName: `${MARK}-${name}`,
      ...(opts.verified ? { identityVerifiedAt: new Date(), identityVerifiedVia: 'phone' } : {}),
    },
  });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId, channelType, uid: `${MARK}-${name}`, profileName: name },
  });
  const conv = await owner.conversation.create({
    data: { tenantId: T, contactId: contact.id, channelId, channelType, assignedToId: agentA.id },
  });
  return { contactId: contact.id, conversationId: conv.id } satisfies Person;
}

function input(p: Person, couponId: string, overrides: Partial<InboxIssueInput> = {}): InboxIssueInput {
  return {
    tenantId: T,
    conversationId: p.conversationId,
    couponId,
    agentId: agentA.id,
    agentName: agentA.name,
    expectedAssigneeId: agentA.id,
    requestKey: randomUUID(),
    ...overrides,
  };
}

const heldBy = (p: Person, couponId?: string) =>
  owner.couponInstance.count({ where: { tenantId: T, contactId: p.contactId, ...(couponId ? { couponId } : {}) } });

async function coupon(name: string, data: Record<string, unknown>, status: 'ACTIVE' | 'PAUSED' = 'ACTIVE') {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(tx, T, creatorId, {
      name: `${MARK} ${name}`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'INB',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 5,
      ...data,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(tx, T, c.id, 'ACTIVE'))).ok);
  if (status === 'PAUSED') assert.ok((await withTenant(prisma, T, (tx) => changeStatus(tx, T, c.id, 'PAUSED'))).ok);
  return c.id;
}

beforeAll(async () => {
  const mkChannel = (channelType: 'LINE' | 'FB') =>
    owner.channel.create({ data: { tenantId: T, channelType, displayName: `${MARK}-${channelType}`, credentialsEncrypted: 'x', isActive: true } });
  lineChannel = (await mkChannel('LINE')).id;
  fbChannel = (await mkChannel('FB')).id;
  const mkAgent = async (name: string) => {
    const a = await owner.agent.create({
      data: { tenantId: T, email: `${MARK}-${name}@example.com`, name, passwordHash: 'x' },
    });
    return { id: a.id, name };
  };
  agentA = await mkAgent('小林');
  agentB = await mkAgent('阿哲');

  coupons.amount = await coupon('小額致歉金', { discountAmount: 200 });
  coupons.minSpend = await coupon('滿千折百', { discountAmount: 100, minSpend: 1000 });
  coupons.expiring = await coupon('即將到期', {
    validityMode: 'FIXED', afterClaimDays: null,
    startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + 2 * DAY),
  });
  coupons.limitOne = await coupon('每人一張', { perContactLimit: 1 });
  coupons.marketing = await coupon('行銷券', { purpose: 'MARKETING' });
  coupons.paused = await coupon('已暫停的補償券', {}, 'PAUSED');
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.message.deleteMany({ where: { conversation: { tenantId: T, contact: contacts } } });
  await owner.conversation.deleteMany({ where: { tenantId: T, contact: contacts } });
  await owner.contactTag.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.channel.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { tenantId: T, email: { startsWith: MARK } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('客服可於對話中發券並歸戶', () => {
  it('座席在對話中發送補償券', async () => {
    const p = await person('發送');
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(await heldBy(p, coupons.amount), 1);
    const sent = delivered.find((d) => d.conversationId === p.conversationId);
    assert.ok(sent && /\/coupon\/open\//.test(sent.text), '訊息內必須有票券連結');

    const msg = await owner.message.findUnique({ where: { id: r.messageId } });
    assert.ok(msg);
    assert.equal(msg.conversationId, p.conversationId);
    assert.equal(msg.direction, 'OUTBOUND');
    assert.equal(msg.senderType, 'AGENT');
    assert.equal(msg.senderId, agentA.id);
    const card = (msg.content as { coupon?: Record<string, unknown> }).coupon;
    assert.equal(card?.instanceId, r.instanceId);
    assert.equal(card?.name, `${MARK} 小額致歉金`);
    assert.equal(card?.discountAmount, 200);

    const instance = await owner.couponInstance.findUnique({ where: { id: r.instanceId } });
    assert.equal(instance?.issuedVia, 'inbox');
    assert.equal(instance?.issuedByName, agentA.name);
  });

  it('發券訊息送不出時券不發出', async () => {
    const p = await person('封鎖');
    unreachable.add(p.conversationId);
    const before = await owner.couponInstance.count({ where: { couponId: coupons.amount } });
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount));
    assert.deepEqual(r, { ok: false, reason: 'COUPON_DELIVERY_FAILED' });
    assert.equal(await heldBy(p), 0);
    assert.equal(await owner.couponInstance.count({ where: { couponId: coupons.amount } }), before);
    assert.equal(await owner.message.count({ where: { conversationId: p.conversationId } }), 0);
  });

  it('只能發客服補償券', async () => {
    const p = await person('行銷券');
    const r = await issueInConversation(prisma, deps, input(p, coupons.marketing));
    assert.equal(r.ok ? 'ok' : r.reason, 'COUPON_NOT_ISSUABLE');
    assert.equal(await heldBy(p), 0);
  });

  it('已暫停的券回報已停止發放', async () => {
    const p = await person('暫停');
    const r = await issueInConversation(prisma, deps, input(p, coupons.paused));
    assert.equal(r.ok ? 'ok' : r.reason, 'COUPON_NOT_ISSUABLE');
  });
});

describe('對話不在座席處理範圍時不發券', () => {
  it('對話已關閉', async () => {
    const p = await person('已關閉');
    await owner.conversation.update({ where: { id: p.conversationId }, data: { status: 'CLOSED' } });
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.equal(ctx?.blocked?.reason, 'CONVERSATION_CLOSED');
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount));
    assert.equal(r.ok ? 'ok' : r.reason, 'CONVERSATION_OUT_OF_SCOPE');
    assert.equal(await heldBy(p), 0);
  });

  it('發送途中對話被轉派', async () => {
    const p = await person('轉派');
    await owner.conversation.update({ where: { id: p.conversationId }, data: { assignedToId: agentB.id } });
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount, { expectedAssigneeId: agentA.id }));
    assert.equal(r.ok ? 'ok' : r.reason, 'CONVERSATION_OUT_OF_SCOPE');
    assert.equal(await heldBy(p), 0);
  });
});

describe('超過回覆期限的渠道不發券', () => {
  async function lastInbound(p: Person, ago: number) {
    await owner.message.create({
      data: {
        conversationId: p.conversationId, direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text',
        content: { text: '你好' }, sequence: 1, createdAt: new Date(clock.now - ago),
      },
    });
  }

  it('Facebook 對話超過 24 小時', async () => {
    const p = await person('FB逾時', fbChannel, 'FB');
    await lastInbound(p, 25 * HOUR);
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.equal(ctx?.blocked?.reason, 'REPLY_WINDOW_EXPIRED');
    assert.equal(ctx?.blocked?.windowHours, 24);
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount));
    assert.equal(r.ok ? 'ok' : r.reason, 'REPLY_WINDOW_EXPIRED');
    assert.equal(await heldBy(p), 0);
  });

  it('Facebook 對話在 24 小時內可以發券', async () => {
    const p = await person('FB期限內', fbChannel, 'FB');
    await lastInbound(p, 2 * HOUR);
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.ok(ctx);
    assert.ok(ctx.blocked === null);
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount));
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('LINE 對話沒有回覆期限', async () => {
    const p = await person('LINE三天');
    await lastInbound(p, 3 * DAY);
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.ok(ctx);
    assert.ok(ctx.blocked === null);
  });
});

describe('同一次發券只成功一次', () => {
  it('網路重試不重複發券', async () => {
    const p = await person('重試');
    const req = input(p, coupons.amount);
    const first = await issueInConversation(prisma, deps, req);
    const second = await issueInConversation(prisma, deps, req);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(second, first);
    assert.equal(await heldBy(p), 1);
  });

  it('查詢發送結果', async () => {
    const p = await person('查詢結果');
    const req = input(p, coupons.amount);
    const r = await issueInConversation(prisma, deps, req);
    const done = await getIssueRequest(deps, T, req.requestKey);
    assert.deepEqual(done, { state: 'done', result: r });
    assert.deepEqual(await getIssueRequest(deps, T, randomUUID()), { state: 'unknown' });

    // 處理中：送出訊息時查詢
    const q = await person('處理中');
    const slow = input(q, coupons.amount);
    deliverDelayMs = 300;
    try {
      const pending = issueInConversation(prisma, deps, slow);
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(await getIssueRequest(deps, T, slow.requestKey), { state: 'pending' });
      const again = await issueInConversation(prisma, deps, slow);
      assert.equal(again.ok ? 'ok' : again.reason, 'ISSUE_IN_PROGRESS');
      assert.equal((await pending).ok, true);
    } finally {
      deliverDelayMs = 0;
    }
  });

  it('發送鍵屬於其他租戶', async () => {
    const p = await person('他租戶');
    const req = input(p, coupons.amount);
    await issueInConversation(prisma, deps, req);
    assert.deepEqual(await getIssueRequest(deps, TENANT_B, req.requestKey), { state: 'unknown' });
  });
});

describe('兩位座席同時發券不超過每人上限', () => {
  it('兩位座席同時發給同一位顧客', async () => {
    const p = await person('同時');
    await owner.conversation.update({ where: { id: p.conversationId }, data: { assignedToId: null } });
    deliverDelayMs = 200;
    try {
      const results = await Promise.all([
        issueInConversation(prisma, deps, input(p, coupons.limitOne, { expectedAssigneeId: null })),
        issueInConversation(prisma, deps, input(p, coupons.limitOne, {
          agentId: agentB.id, agentName: agentB.name, expectedAssigneeId: null,
        })),
      ]);
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      assert.equal(ok.length, 1, JSON.stringify(results));
      assert.equal(failed.length, 1);
      const f = failed[0];
      assert.ok(!f.ok);
      assert.equal(f.reason, 'PER_CONTACT_LIMIT_REACHED');
      const winner = results[0].ok ? agentA.name : agentB.name;
      assert.equal(f.details?.issuedByName, winner);
      assert.equal(await heldBy(p, coupons.limitOne), 1);
    } finally {
      deliverDelayMs = 0;
    }
  });
});

describe('發券面板列出可發的補償券', () => {
  it('只列出發布中的客服補償券', async () => {
    const p = await person('清單');
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.ok(ctx);
    const ids = ctx.coupons.map((c) => c.id);
    assert.ok(ids.includes(coupons.amount));
    assert.ok(ids.includes(coupons.minSpend));
    assert.ok(!ids.includes(coupons.marketing));
    assert.ok(!ids.includes(coupons.paused));
    assert.equal(ctx.conversation.contactName, `${MARK}-清單`);
    assert.equal(ctx.conversation.assignedToId, agentA.id);
  });

  it('有消費門檻的券排在前面', async () => {
    const p = await person('排序');
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.ok(ctx);
    const firstWithout = ctx.coupons.findIndex((c) => !c.drivesSpend);
    const lastWith = ctx.coupons.map((c) => c.drivesSpend).lastIndexOf(true);
    assert.ok(lastWith >= 0, '至少一張有門檻的券');
    assert.ok(lastWith < firstWithout, '有門檻的券都排在沒有門檻的券前面');
    assert.equal(ctx.coupons.find((c) => c.id === coupons.minSpend)?.drivesSpend, true);
  });

  it('已達每人上限的券', async () => {
    const p = await person('已達上限');
    const r = await issueInConversation(prisma, deps, input(p, coupons.limitOne));
    assert.ok(r.ok);
    const redeemedAt = new Date(clock.now - HOUR);
    await owner.couponInstance.update({ where: { id: r.instanceId }, data: { status: 'REDEEMED', redeemedAt } });
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    const c = ctx?.coupons.find((x) => x.id === coupons.limitOne);
    assert.ok(c);
    assert.equal(c.receivedCount, 1);
    assert.equal(c.limitReached, true);
    assert.ok(c.lastClaimedAt);
    assert.equal(c.lastRedeemedAt?.getTime(), redeemedAt.getTime());
  });

  it('即將到期的券', async () => {
    const p = await person('到期');
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    const expiring = ctx?.coupons.find((x) => x.id === coupons.expiring);
    assert.ok(expiring?.expiringAt, '2 天後結束的券標示即將到期');
    assert.ok(ctx?.coupons.find((x) => x.id === coupons.amount)?.expiringAt === null);
  });
});

describe('發券面板顯示顧客近 90 天的補償紀錄', () => {
  it('有補償紀錄', async () => {
    const p = await person('補償紀錄');
    const mk = (ago: number, status: 'REDEEMED' | 'CLAIMED') =>
      owner.couponInstance.create({
        data: {
          tenantId: T, couponId: coupons.amount, contactId: p.contactId, code: `${MARK}-${ago}`,
          status, issuedAt: new Date(clock.now - ago), claimedAt: new Date(clock.now - ago),
          issuedVia: 'inbox', issuedByName: '阿哲',
          ...(status === 'REDEEMED' ? { redeemedAt: new Date(clock.now - ago + HOUR) } : {}),
        },
      });
    await mk(30 * DAY, 'REDEEMED');
    await mk(100 * DAY, 'CLAIMED');
    // 行銷券不算補償
    await owner.couponInstance.create({
      data: { tenantId: T, couponId: coupons.marketing, contactId: p.contactId, code: `${MARK}-mkt`, status: 'CLAIMED', issuedAt: new Date(clock.now - DAY) },
    });
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.ok(ctx);
    assert.equal(ctx.history.count, 1);
    assert.equal(ctx.history.totalAmount, 200);
    assert.equal(ctx.history.latest?.status, 'USED');
    assert.equal(ctx.history.latest?.issuedByName, '阿哲');
    assert.equal(ctx.history.latest?.couponName, `${MARK} 小額致歉金`);
  });

  it('沒有補償紀錄', async () => {
    const p = await person('無補償');
    const ctx = await getIssueContext(prisma, deps, { tenantId: T, conversationId: p.conversationId });
    assert.ok(ctx);
    assert.equal(ctx.history.count, 0);
    assert.equal(ctx.history.totalAmount, 0);
    assert.ok(ctx.history.latest === null);
  });
});

describe('聯絡人的已發優惠券', () => {
  it('顧客開啟票券連結後狀態變為已領取', async () => {
    const p = await person('開啟連結', lineChannel, 'LINE', { verified: true });
    const r = await issueInConversation(prisma, deps, input(p, coupons.amount));
    assert.ok(r.ok);
    let list = await listIssuedCoupons(tenantScopedClient(prisma, T), T, p.conversationId);
    assert.equal(list?.find((x) => x.id === r.instanceId)?.status, 'SENT');
    assert.equal(list?.[0]?.issuedByName, agentA.name);

    const msg = delivered.filter((d) => d.conversationId === p.conversationId).at(-1)!;
    const token = /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
    assert.ok(token);
    const s = await openWalletSession(prisma, deps, token);
    assert.equal(s.status, 'ok');
    list = await listIssuedCoupons(tenantScopedClient(prisma, T), T, p.conversationId);
    assert.equal(list?.find((x) => x.id === r.instanceId)?.status, 'VIEWED');
  });
});

describe('發行控制：每人上限的計算', () => {
  const issue = (p: Person) =>
    issueCoupons(prisma, T, coupons.limitOne, { contactIds: [p.contactId], issuedVia: 'keyword' });

  it('已使用的券計入每人上限', async () => {
    const p = await person('用過');
    const first = await issue(p);
    assert.equal(first.issued.length, 1);
    await owner.couponInstance.update({ where: { id: first.issued[0].id }, data: { status: 'REDEEMED', redeemedAt: new Date() } });
    const second = await issue(p);
    assert.equal(second.issued.length, 0);
    assert.equal(second.skipped[0]?.reason, 'PER_CONTACT_LIMIT_REACHED');
  });

  it('已過期或已撤回的券不計入每人上限', async () => {
    const p = await person('過期');
    const first = await issue(p);
    await owner.couponInstance.update({ where: { id: first.issued[0].id }, data: { status: 'EXPIRED' } });
    const second = await issue(p);
    assert.equal(second.issued.length, 1);
  });
});
