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
import { withTenant } from '#src/lib/tenant-db.js';
import { memBindingStore, slowStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { listWallet } from '#src/modules/coupon/coupon-wallet.service.js';
import { openWalletSessionFlow } from '#src/modules/coupon/coupon-wallet.flow.js';
import { sweepStalePendingIssues } from '#src/modules/coupon/coupon.scheduler.js';
import {
  getIssueContext,
  getIssueRequest,
  listIssuedCoupons,
  voidPendingInstance,
  type InboxIssueInput,
} from '#src/modules/coupon/coupon-inbox.service.js';
import { backendPid, waitUntilBlockedBy } from '#tests/support/wait-for-lock-wait.js';
import { issueInConversation, type InboxFlowDeps } from '#src/modules/coupon/coupon-inbox.flow.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';

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

const deps: InboxFlowDeps = {
  prisma,
  io: testIo,
  store: memBindingStore(clock),
  now: () => clock.now,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (params) => {
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
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} ${name}`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'INB',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 5,
      ...data,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  if (status === 'PAUSED') assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'PAUSED'))).ok);
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
    const r = await issueInConversation(deps, input(p, coupons.amount));
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
    const r = await issueInConversation(deps, input(p, coupons.amount));
    assert.deepEqual(r, { ok: false, reason: 'COUPON_DELIVERY_FAILED' });
    assert.equal(await heldBy(p), 0);
    assert.equal(await owner.couponInstance.count({ where: { couponId: coupons.amount } }), before);
    assert.equal(await owner.message.count({ where: { conversationId: p.conversationId } }), 0);
  });

  it('只能發客服補償券', async () => {
    const p = await person('行銷券');
    const r = await issueInConversation(deps, input(p, coupons.marketing));
    assert.equal(r.ok ? 'ok' : r.reason, 'COUPON_NOT_ISSUABLE');
    assert.equal(await heldBy(p), 0);
  });

  it('已暫停的券回報已停止發放', async () => {
    const p = await person('暫停');
    const r = await issueInConversation(deps, input(p, coupons.paused));
    assert.equal(r.ok ? 'ok' : r.reason, 'COUPON_NOT_ISSUABLE');
  });
});

describe('對話不在座席處理範圍時不發券', () => {
  it('對話已關閉', async () => {
    const p = await person('已關閉');
    await owner.conversation.update({ where: { id: p.conversationId }, data: { status: 'CLOSED' } });
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.equal(ctx?.blocked?.reason, 'CONVERSATION_CLOSED');
    const r = await issueInConversation(deps, input(p, coupons.amount));
    assert.equal(r.ok ? 'ok' : r.reason, 'CONVERSATION_OUT_OF_SCOPE');
    assert.equal(await heldBy(p), 0);
  });

  it('機器人處理中的對話不能發券', async () => {
    const p = await person('機器人處理中');
    await owner.conversation.update({ where: { id: p.conversationId }, data: { status: 'BOT_HANDLED' } });
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.equal(ctx?.blocked?.reason, 'BOT_HANDLED');
    const r = await issueInConversation(deps, input(p, coupons.amount));
    assert.equal(r.ok ? 'ok' : r.reason, 'CONVERSATION_BOT_HANDLED');
    assert.equal(await heldBy(p), 0);
  });

  it('發送途中對話被轉派', async () => {
    const p = await person('轉派');
    await owner.conversation.update({ where: { id: p.conversationId }, data: { assignedToId: agentB.id } });
    const r = await issueInConversation(deps, input(p, coupons.amount, { expectedAssigneeId: agentA.id }));
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
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.equal(ctx?.blocked?.reason, 'REPLY_WINDOW_EXPIRED');
    assert.equal(ctx?.blocked?.windowHours, 24);
    const r = await issueInConversation(deps, input(p, coupons.amount));
    assert.equal(r.ok ? 'ok' : r.reason, 'REPLY_WINDOW_EXPIRED');
    assert.equal(await heldBy(p), 0);
  });

  it('Facebook 對話在 24 小時內可以發券', async () => {
    const p = await person('FB期限內', fbChannel, 'FB');
    await lastInbound(p, 2 * HOUR);
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.ok(ctx);
    assert.ok(ctx.blocked === null);
    const r = await issueInConversation(deps, input(p, coupons.amount));
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('LINE 對話沒有回覆期限', async () => {
    const p = await person('LINE三天');
    await lastInbound(p, 3 * DAY);
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.ok(ctx);
    assert.ok(ctx.blocked === null);
  });
});

describe('同一次發券只成功一次', () => {
  it('網路重試不重複發券', async () => {
    const p = await person('重試');
    const req = input(p, coupons.amount);
    const first = await issueInConversation(deps, req);
    const second = await issueInConversation(deps, req);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(second, first);
    assert.equal(await heldBy(p), 1);
  });

  it('同一個發送鍵在處理期間不斷重送也只發一張', async () => {
    const p = await person('並發重送');
    const req = input(p, coupons.amount);
    // 模擬 Redis 往返延遲，並在第一個請求處理期間持續重送，涵蓋「寫入結果前」的時間點
    const slow = { ...deps, store: slowStore(deps.store) };
    let done = false;
    const first = issueInConversation(slow, req).finally(() => { done = true; });
    const retries: Promise<unknown>[] = [];
    // 設截止時間：第一個請求卡住時測試失敗，而不是在逾時後於背景持續重送、干擾後面的測試
    const deadline = Date.now() + 10_000;
    while (!done && Date.now() < deadline) {
      retries.push(issueInConversation(slow, req));
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.ok(done, '第一個發券請求在 10 秒內沒有完成');
    for (let i = 0; i < 20; i++) {
      retries.push(issueInConversation(slow, req));
      await new Promise((r) => setTimeout(r, 1));
    }
    await Promise.all(retries);
    assert.equal((await first).ok, true);
    assert.equal(await heldBy(p), 1);
  });

  it('查詢發送結果', async () => {
    const p = await person('查詢結果');
    const req = input(p, coupons.amount);
    const r = await issueInConversation(deps, req);
    const done = await getIssueRequest(deps, T, req.requestKey);
    assert.deepEqual(done, { state: 'done', result: r });
    assert.deepEqual(await getIssueRequest(deps, T, randomUUID()), { state: 'unknown' });

    // 處理中：送出訊息時查詢
    const q = await person('處理中');
    const slow = input(q, coupons.amount);
    deliverDelayMs = 300;
    try {
      const pending = issueInConversation(deps, slow);
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(await getIssueRequest(deps, T, slow.requestKey), { state: 'pending' });
      const again = await issueInConversation(deps, slow);
      assert.equal(again.ok ? 'ok' : again.reason, 'ISSUE_IN_PROGRESS');
      assert.equal((await pending).ok, true);
    } finally {
      deliverDelayMs = 0;
    }
  });

  it('發送鍵屬於其他租戶', async () => {
    const p = await person('他租戶');
    const req = input(p, coupons.amount);
    await issueInConversation(deps, req);
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
        issueInConversation(deps, input(p, coupons.limitOne, { expectedAssigneeId: null })),
        issueInConversation(deps, input(p, coupons.limitOne, {
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
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
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
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.ok(ctx);
    const firstWithout = ctx.coupons.findIndex((c) => !c.drivesSpend);
    const lastWith = ctx.coupons.map((c) => c.drivesSpend).lastIndexOf(true);
    assert.ok(lastWith >= 0, '至少一張有門檻的券');
    assert.ok(lastWith < firstWithout, '有門檻的券都排在沒有門檻的券前面');
    assert.equal(ctx.coupons.find((c) => c.id === coupons.minSpend)?.drivesSpend, true);
  });

  it('已達每人上限的券', async () => {
    const p = await person('已達上限');
    const r = await issueInConversation(deps, input(p, coupons.limitOne));
    assert.ok(r.ok);
    const redeemedAt = new Date(clock.now - HOUR);
    await owner.couponInstance.update({ where: { id: r.instanceId }, data: { status: 'REDEEMED', redeemedAt } });
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    const c = ctx?.coupons.find((x) => x.id === coupons.limitOne);
    assert.ok(c);
    assert.equal(c.receivedCount, 1);
    assert.equal(c.limitReached, true);
    assert.ok(c.lastClaimedAt);
    assert.equal(c.lastRedeemedAt?.getTime(), redeemedAt.getTime());
  });

  it('即將到期的券', async () => {
    const p = await person('到期');
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
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
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.ok(ctx);
    assert.equal(ctx.history.count, 1);
    assert.equal(ctx.history.totalAmount, 200);
    assert.equal(ctx.history.latest?.status, 'USED');
    assert.equal(ctx.history.latest?.issuedByName, '阿哲');
    assert.equal(ctx.history.latest?.couponName, `${MARK} 小額致歉金`);
  });

  it('沒有補償紀錄', async () => {
    const p = await person('無補償');
    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    assert.ok(ctx);
    assert.equal(ctx.history.count, 0);
    assert.equal(ctx.history.totalAmount, 0);
    assert.ok(ctx.history.latest === null);
  });
});

describe('聯絡人的已發優惠券', () => {
  it('顧客開啟票券連結後狀態變為已領取', async () => {
    const p = await person('開啟連結', lineChannel, 'LINE', { verified: true });
    const r = await issueInConversation(deps, input(p, coupons.amount));
    assert.ok(r.ok);
    let list = await runInTenant(prisma, T, (ctx) => listIssuedCoupons(ctx, p.conversationId));
    assert.equal(list?.find((x) => x.id === r.instanceId)?.status, 'SENT');
    assert.equal(list?.[0]?.issuedByName, agentA.name);

    const msg = delivered.filter((d) => d.conversationId === p.conversationId).at(-1)!;
    const token = /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
    assert.ok(token);
    const s = await openWalletSessionFlow({ ...deps, prisma, io: testIo }, token);
    assert.equal(s.status, 'ok');
    list = await runInTenant(prisma, T, (ctx) => listIssuedCoupons(ctx, p.conversationId));
    assert.equal(list?.find((x) => x.id === r.instanceId)?.status, 'VIEWED');
  });
});

describe('發行控制：每人上限的計算', () => {
  const issue = (p: Person) =>
    runInTenant(prisma, T, (ctx) => issueCoupons(ctx, coupons.limitOne, { contactIds: [p.contactId], issuedVia: 'keyword' }));

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

  it('效期已過、狀態還沒改成已過期的券也不計入每人上限（發券與發券面板）', async () => {
    const p = await person('時間過期');
    const first = await issue(p);
    assert.equal(first.issued.length, 1);
    // 系統沒有排程把券改成 EXPIRED：只有效期過了，狀態仍是已領取
    await owner.couponInstance.update({ where: { id: first.issued[0].id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const ctx = await runInTenant(prisma, T, (c) => getIssueContext(c, deps, p.conversationId));
    const panel = ctx?.coupons.find((c) => c.id === coupons.limitOne);
    assert.equal(panel?.limitReached, false, '發券面板仍顯示已達上限');
    assert.equal(panel?.receivedCount, 0);

    const second = await issue(p);
    assert.equal(second.issued.length, 1, JSON.stringify(second.skipped));
  });
});

describe('對話發券先保留再發送（design D16）', () => {
  it('發送時不佔住券的鎖', async () => {
    const slow = await person('慢渠道');
    const other = await person('同時發其他人');
    deliverDelayMs = 800;
    try {
      const pending = issueInConversation(deps, input(slow, coupons.amount));
      await new Promise((r) => setTimeout(r, 150));
      const started = Date.now();
      // 同一張券的其他發放（群發、關鍵字）不必等慢渠道回應
      const bulk = await runInTenant(prisma, T, (ctx) => issueCoupons(ctx, coupons.amount, { contactIds: [other.contactId], issuedVia: 'broadcast' }));
      const elapsed = Date.now() - started;
      assert.equal(bulk.issued.length, 1);
      assert.ok(elapsed < 400, `群發等了 ${elapsed}ms，代表被對話發券的鎖擋住`);
      assert.equal((await pending).ok, true);
    } finally {
      deliverDelayMs = 0;
    }
  });

  it('發券訊息送不出時券作廢並歸還名額', async () => {
    const p = await person('封鎖後再發');
    unreachable.add(p.conversationId);
    const failed = await issueInConversation(deps, input(p, coupons.limitOne));
    assert.equal(failed.ok ? 'ok' : failed.reason, 'COUPON_DELIVERY_FAILED');
    assert.equal(await heldBy(p, coupons.limitOne), 0, '券不留下');
    assert.equal(await owner.message.count({ where: { conversationId: p.conversationId } }), 0, '對話不留下券訊息');
    unreachable.delete(p.conversationId);
    // 每人一張的券，送失敗後名額歸還，可以再發
    const retry = await issueInConversation(deps, input(p, coupons.limitOne));
    assert.equal(retry.ok, true, JSON.stringify(retry));
  });

  it('發券訊息送不出時序號包的序號放回', async () => {
    // 序號包要先有序號才能發布
    const draft = await withTenant(prisma, T, (tx) =>
      createCoupon(ctxOf(tx, T), creatorId, {
        name: `${MARK} 序號包補償券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
        validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'IMPORTED_CODES',
        redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 5,
      } as never));
    const id = draft.id;
    const code = await owner.couponCode.create({ data: { tenantId: T, couponId: id, code: `${MARK.slice(-8).toUpperCase()}POOL` } });
    assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), id, 'ACTIVE'))).ok);
    const p = await person('序號包封鎖');
    unreachable.add(p.conversationId);
    const r = await issueInConversation(deps, input(p, id));
    assert.equal(r.ok ? 'ok' : r.reason, 'COUPON_DELIVERY_FAILED');
    const after = await owner.couponCode.findUnique({ where: { id: code.id } });
    assert.equal(after?.status, 'AVAILABLE');
    assert.equal(after?.instanceId, null);
  });

  it('發送中的券顧客看不到', async () => {
    const p = await person('發送中', lineChannel, 'LINE', { verified: true });
    deliverDelayMs = 500;
    try {
      const pending = issueInConversation(deps, input(p, coupons.amount));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(await heldBy(p, coupons.amount), 1, '已保留');
      const wallet = await runInTenant(prisma, T, (ctx) => listWallet(ctx, { tenantId: T, contactId: p.contactId }));
      assert.equal(wallet.items.length, 0, '發送完成前不出現在票券夾');
      assert.equal((await pending).ok, true);
      const after = await runInTenant(prisma, T, (ctx) => listWallet(ctx, { tenantId: T, contactId: p.contactId }));
      assert.equal(after.items.length, 1);
    } finally {
      deliverDelayMs = 0;
    }
  });

  it('卡在發送中的券由排程作廢', async () => {
    const p = await person('卡住');
    const stale = await owner.couponInstance.create({
      data: { tenantId: T, couponId: coupons.limitOne, contactId: p.contactId, code: `${MARK.slice(-6).toUpperCase()}STALE`, status: 'CLAIMED', claimedAt: new Date(), issuedVia: 'inbox', deliveryPendingAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    const fresh = await owner.couponInstance.create({
      data: { tenantId: T, couponId: coupons.amount, contactId: p.contactId, code: `${MARK.slice(-6).toUpperCase()}FRESH`, status: 'CLAIMED', claimedAt: new Date(), issuedVia: 'inbox', deliveryPendingAt: new Date(Date.now() - 60 * 1000) },
    });
    const swept = await sweepStalePendingIssues({ admin: owner, prisma }, Date.now(), testIo);
    assert.ok(swept >= 1);
    assert.equal(await owner.couponInstance.count({ where: { id: stale.id } }), 0, '超過 5 分鐘的作廢');
    assert.equal(await owner.couponInstance.count({ where: { id: fresh.id } }), 1, '還在發送中的不動');
    await owner.couponInstance.delete({ where: { id: fresh.id } });
  });

  it('確認交易進行中時作廢，不會歸還已發出的序號', async () => {
    const p = await person('確認競態');
    const tag = MARK.slice(-6).toUpperCase();
    const inst = await owner.couponInstance.create({
      data: { tenantId: T, couponId: coupons.limitOne, contactId: p.contactId, code: `${tag}RACE`, status: 'CLAIMED', claimedAt: new Date(), issuedVia: 'inbox', deliveryPendingAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    const poolCode = await owner.couponCode.create({
      data: { tenantId: T, couponId: coupons.limitOne, code: `${tag}RACEPOOL`, status: 'ASSIGNED', instanceId: inst.id },
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let confirmPid = 0;
    let markConfirmed: () => void = () => undefined;
    const confirmedInTx = new Promise<void>((r) => { markConfirmed = r; });
    try {
      // 確認交易：清除發送中標記（持有列鎖）後先不提交
      const confirming = withTenant(prisma, T, async (tx) => {
        confirmPid = await backendPid(tx);
        await tx.couponInstance.updateMany({
          where: { id: inst.id, tenantId: T, deliveryPendingAt: { not: null } },
          data: { deliveryPendingAt: null },
        });
        markConfirmed();
        await gate;
      });
      await confirmedInTx;
      const voiding = runInTenant(prisma, T, (ctx) => voidPendingInstance(ctx, inst.id));
      await waitUntilBlockedBy(owner, confirmPid);
      release();
      await confirming;
      assert.equal(await voiding, false, '已確認的券不能作廢');
      const after = await owner.couponCode.findUnique({ where: { id: poolCode.id } });
      assert.equal(after?.status, 'ASSIGNED', '已發出的序號被歸還，之後會再發給別人');
      assert.equal(after?.instanceId, inst.id);
    } finally {
      release();
      await owner.couponCode.deleteMany({ where: { id: poolCode.id } });
      await owner.couponInstance.deleteMany({ where: { id: inst.id } });
    }
  });
});

describe('訊息已送出但確認失敗', () => {
  it('不清掉發送鍵，重送不會再發一張', async () => {
    const p = await person('確認失敗');
    let sends = 0;
    const failingDeps: InboxFlowDeps = {
      ...deps,
      deliver: async () => {
        sends += 1;
        // 訊息送出後對話被刪除：確認交易寫入對話訊息時失敗
        await owner.conversation.delete({ where: { id: p.conversationId } });
        return { sent: true };
      },
    };
    const key = randomUUID();
    const first = await issueInConversation(failingDeps, input(p, coupons.amount, { requestKey: key }));
    assert.equal(first.ok ? 'ok' : first.reason, 'DELIVERED_UNCONFIRMED');
    const again = await issueInConversation(failingDeps, input(p, coupons.amount, { requestKey: key }));
    assert.deepEqual(again, first);
    assert.equal(sends, 1, '重送沒有再送一次訊息');
  });
});

