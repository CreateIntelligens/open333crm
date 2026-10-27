/**
 * 傳訊領券的入站處理（add-coupon-system A15 15.28；design D30）。
 *
 * 以真實 Postgres 跑完整的 processInboundMessage：client 用 app_admin（與正式環境 webhook 的
 * prismaAdmin 相同），發券在 inTenant 交易內（RLS 也成立）。建立與清理資料用 owner 連線。
 * 票券連結權杖用記憶體儲存，訊息送出以替身記錄，不碰渠道 API。
 * 本檔建立的券以 createdById 標記，聯絡人、渠道以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';
import { setCouponClaimDepsForTest } from '#src/modules/webhook/inbound-coupon-claim.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { createClaimLink, setClaimLinkStatus } from '#src/modules/coupon/coupon-claim-link.service.js';
import { claimPrefillText } from '#src/modules/coupon/coupon-claim-code.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
/** webhook 在正式環境用 prismaAdmin（BYPASSRLS）處理入站 */
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
const T = TENANT_A;
const MARK = `coupon-claimin-${Date.now().toString(36)}`;
const creatorId = randomUUID();
const WEB = 'https://crm.example.com';

const delivered: Array<{ conversationId: string; text: string; replyToken?: string }> = [];
/** 這些對話的訊息送不出（模擬顧客封鎖） */
const unreachable = new Set<string>();

const received: AppEvent[] = [];
eventBus.subscribe('message.received', (e) => {
  received.push(e);
});

const channels = { lineA: '', fb: '', ig: '', lineB: '' };
let seq = 0;

async function coupon(tenantId: string, name: string, data: Record<string, unknown> = {}) {
  const c = await withTenant(tenantDb, tenantId, (tx) =>
    createCoupon(ctxOf(tx, tenantId), creatorId, {
      name: `${MARK} ${name}`, couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'CLI',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 1,
      ...data,
    } as never));
  assert.ok((await withTenant(tenantDb, tenantId, (tx) => changeStatus(ctxOf(tx, tenantId), c.id, 'ACTIVE'))).ok);
  return c.id;
}

async function link(tenantId: string, couponId: string, channelId: string, name = '門市海報') {
  const l = await runInTenant(tenantDb, tenantId, (ctx) => createClaimLink(ctx, couponId, creatorId, { name, channelId }, WEB));
  assert.ok(l);
  return l;
}

async function person(channelId: string, channelType: 'LINE' | 'FB' | 'THREADS', tenantId = T) {
  const uid = `${MARK}-${seq++}`;
  const contact = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-${uid}` } });
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId, channelType, uid } });
  const conv = await owner.conversation.create({ data: { tenantId, contactId: contact.id, channelId, channelType } });
  return { uid, contactId: contact.id, conversationId: conv.id };
}

function text(uid: string, body: string, replyToken?: string): ParsedWebhookMessage {
  return {
    contactUid: uid,
    channelMsgId: `${MARK}-mid-${seq++}`,
    timestamp: new Date(),
    contentType: 'text',
    content: { text: body },
    ...(replyToken ? { rawPayload: { replyToken } } : {}),
  } as ParsedWebhookMessage;
}

function run(channelId: string, channelType: string, parsed: ParsedWebhookMessage, tenantId = T) {
  return processInboundMessage(admin, testIo, {}, { id: channelId, channelType }, tenantId, parsed);
}

const instancesOf = (contactId: string) => owner.couponInstance.findMany({ where: { contactId } });
const sentTo = (conversationId: string) => delivered.filter((d) => d.conversationId === conversationId);
const receivedFor = (conversationId: string) =>
  received.filter((e) => (e.payload as { conversationId?: string }).conversationId === conversationId);

beforeAll(async () => {
  const mk = (tenantId: string, channelType: 'LINE' | 'FB' | 'THREADS', handle: string) =>
    owner.channel.create({
      data: {
        tenantId, channelType, displayName: `${MARK}-${channelType}-${handle}`, credentialsEncrypted: 'x', isActive: true,
        settings: { bindingHandleAuto: handle },
      },
    });
  channels.lineA = (await mk(T, 'LINE', '@shopA')).id;
  channels.fb = (await mk(T, 'FB', 'shop.page')).id;
  channels.ig = (await mk(T, 'THREADS', 'shop.ig')).id;
  channels.lineB = (await mk(TENANT_B, 'LINE', '@otherB')).id;
});

beforeEach(() => {
  setCouponClaimDepsForTest({
    store: memBindingStore(),
    webBaseUrl: WEB,
    deliver: async (p) => {
      if (unreachable.has(p.conversationId)) return false;
      delivered.push(p);
      return true;
    },
  });
});

afterAll(async () => {
  setCouponClaimDepsForTest(null);
  const contacts = { displayName: { startsWith: MARK } };
  await owner.couponClaimLink.deleteMany({ where: { createdById: creatorId } });
  await owner.coupon.deleteMany({ where: { createdById: creatorId } });
  await owner.message.deleteMany({ where: { conversation: { contact: contacts } } });
  await owner.conversation.deleteMany({ where: { contact: contacts } });
  await owner.channelIdentity.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.channel.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
  await admin.$disconnect();
});

describe('顧客傳送領券代碼後發券', () => {
  it('顧客傳送領券訊息', async () => {
    const couponId = await coupon(T, '秋季九折');
    const l = await link(T, couponId, channels.lineA);
    const p = await person(channels.lineA, 'LINE');

    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code), 'reply-token-1'));

    const sent = sentTo(p.conversationId);
    assert.equal(sent.length, 1, '回覆一則發券訊息');
    assert.match(sent[0]!.text, /\/coupon\/open\//, '訊息內有票券連結');
    assert.equal(sent[0]!.replyToken, 'reply-token-1', '以回覆方式送出');
    assert.equal(receivedFor(p.conversationId).length, 0, '不觸發 AI 與關鍵字');

    const [instance] = await instancesOf(p.contactId);
    assert.ok(instance);
    assert.equal(instance.issuedVia, 'public_link');
    assert.equal(instance.issuedSourceName, '門市海報');
    assert.equal(instance.issuedRefId, l.id);
    assert.equal(instance.status, 'CLAIMED');
    assert.equal(instance.deliveryPendingAt, null, '已確認發出');
    assert.equal((await owner.couponClaimLink.findUnique({ where: { id: l.id } }))?.claimCount, 1, '領取數加 1');

    const card = await owner.message.findFirst({ where: { conversationId: p.conversationId, direction: 'OUTBOUND' } });
    assert.equal((card?.content as { coupon?: { instanceId?: string } }).coupon?.instanceId, instance.id, '收件匣畫成券卡');
  });

  it('領券貼標的到期時間以流程的時間計算', async () => {
    // PR #364 審查：confirmClaim 收到流程的時間卻沒傳給貼標，標籤到期時間改用系統當下時間
    const fixed = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tag = await owner.tag.create({ data: { tenantId: T, name: `${MARK}-claim-tag`, scope: 'CONTACT' } });
    try {
      const couponId = await coupon(T, '貼標時效', { claimTagId: tag.id, claimTagTtlDays: 7 });
      const l = await link(T, couponId, channels.lineA);
      const p = await person(channels.lineA, 'LINE');
      setCouponClaimDepsForTest({
        store: memBindingStore(),
        webBaseUrl: WEB,
        now: () => fixed,
        deliver: async (d) => {
          delivered.push(d);
          return true;
        },
      });

      await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));

      const ct = await owner.contactTag.findUnique({ where: { contactId_tagId: { contactId: p.contactId, tagId: tag.id } } });
      assert.equal(ct?.expiresAt?.getTime(), fixed + 7 * 24 * 60 * 60 * 1000);
    } finally {
      await owner.contactTag.deleteMany({ where: { tagId: tag.id } });
      await owner.coupon.updateMany({ where: { claimTagId: tag.id }, data: { claimTagId: null } });
      await owner.tag.deleteMany({ where: { id: tag.id } });
    }
  });

  it('顧客改動預填文字', async () => {
    const couponId = await coupon(T, '改字');
    const l = await link(T, couponId, channels.lineA);
    const p = await person(channels.lineA, 'LINE');
    const spaced = `${l.code.slice(0, 4)} ${l.code.slice(4)}`.toLowerCase();

    await run(channels.lineA, 'LINE', text(p.uid, `領券 ${spaced}`));

    assert.equal((await instancesOf(p.contactId)).length, 1, '忽略大小寫與空白，照常發券');
    assert.equal(receivedFor(p.conversationId).length, 0);
  });

  it('全形的代碼也認得', async () => {
    const couponId = await coupon(T, '全形');
    const l = await link(T, couponId, channels.lineA);
    const p = await person(channels.lineA, 'LINE');
    const fullWidth = [...l.code].map((ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).join('');

    await run(channels.lineA, 'LINE', text(p.uid, `代碼${fullWidth}`));

    assert.equal((await instancesOf(p.contactId)).length, 1);
  });

  it('Instagram 顧客點導流連結', async () => {
    const couponId = await coupon(T, 'IG 限定');
    const l = await link(T, couponId, channels.ig, 'IG 貼文');
    const uid = `${MARK}-ig-${seq++}`;

    await run(channels.ig, 'THREADS', {
      contactUid: uid, timestamp: new Date(), contentType: 'referral', content: {}, referralRef: `coupon_${l.code}`,
    } as ParsedWebhookMessage);

    const identity = await owner.channelIdentity.findFirst({ where: { channelId: channels.ig, uid } });
    assert.ok(identity, '建立聯絡人');
    await owner.contact.update({ where: { id: identity.contactId }, data: { displayName: `${MARK}-${uid}` } });
    const instances = await instancesOf(identity.contactId);
    assert.equal(instances.length, 1, '對這位聯絡人發券');
    assert.equal(instances[0]!.issuedSourceName, 'IG 貼文');
    const conv = await owner.conversation.findFirst({ where: { channelId: channels.ig, contactId: identity.contactId } });
    assert.equal(sentTo(conv!.id).length, 1, '回覆發券訊息');
    assert.match(sentTo(conv!.id)[0]!.text, /\/coupon\/open\//);
  });

  it('同一個導流事件重送不重複發券', async () => {
    const couponId = await coupon(T, 'FB 重送', { perContactLimit: 5 });
    const l = await link(T, couponId, channels.fb, 'FB 廣告');
    const p = await person(channels.fb, 'FB');
    const event = { contactUid: p.uid, timestamp: new Date(), contentType: 'referral', content: {}, referralRef: `coupon_${l.code}` } as ParsedWebhookMessage;

    await run(channels.fb, 'FB', event);
    await run(channels.fb, 'FB', event);

    assert.equal((await instancesOf(p.contactId)).length, 1);
  });
});

describe('公開領券失敗時回覆顧客', () => {
  it('已領過', async () => {
    const couponId = await coupon(T, '每人一張', { perContactLimit: 1 });
    const l = await link(T, couponId, channels.lineA);
    const p = await person(channels.lineA, 'LINE');
    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));
    assert.equal((await instancesOf(p.contactId)).length, 1);

    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));

    const last = sentTo(p.conversationId).at(-1);
    assert.equal(last?.text, '您已經領過這張優惠券');
    assert.equal((await instancesOf(p.contactId)).length, 1, '沒有新增券');
    const note = await owner.message.findFirst({
      where: { conversationId: p.conversationId, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal((note?.metadata as { couponClaimFailed?: { reason?: string } }).couponClaimFailed?.reason, 'ALREADY_CLAIMED', '對話留下紀錄');
    assert.equal(receivedFor(p.conversationId).length, 0);
  });

  it('已領完', async () => {
    const couponId = await coupon(T, '限量一張', { totalLimit: 1, perContactLimit: 1 });
    const l = await link(T, couponId, channels.lineA);
    const first = await person(channels.lineA, 'LINE');
    await run(channels.lineA, 'LINE', text(first.uid, claimPrefillText(l.code)));
    const p = await person(channels.lineA, 'LINE');

    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));

    assert.equal(sentTo(p.conversationId).at(-1)?.text, '優惠券已全數領完');
    assert.equal((await instancesOf(p.contactId)).length, 0);
  });

  it('連結已停用', async () => {
    const couponId = await coupon(T, '停用連結');
    const l = await link(T, couponId, channels.lineA);
    await runInTenant(tenantDb, T, (ctx) => setClaimLinkStatus(ctx, couponId, l.id, 'DISABLED', WEB));
    const p = await person(channels.lineA, 'LINE');

    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));

    assert.equal(sentTo(p.conversationId).at(-1)?.text, '這個領券活動目前無法領取');
    assert.equal((await instancesOf(p.contactId)).length, 0);
  });

  it('代碼送到其他渠道', async () => {
    const couponId = await coupon(T, '只限 LINE');
    const l = await link(T, couponId, channels.lineA);
    const p = await person(channels.fb, 'FB');

    await run(channels.fb, 'FB', text(p.uid, claimPrefillText(l.code)));

    assert.equal(sentTo(p.conversationId).at(-1)?.text, '請到 LINE（@shopA）領取');
    assert.equal((await instancesOf(p.contactId)).length, 0, '沒有新增券');
  });

  it('其他租戶的代碼', async () => {
    const couponB = await coupon(TENANT_B, '租戶乙的券');
    const l = await link(TENANT_B, couponB, channels.lineB);
    const p = await person(channels.lineA, 'LINE');

    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));

    assert.equal(sentTo(p.conversationId).length, 0, '不當成領券代碼處理');
    assert.equal(receivedFor(p.conversationId).length, 1, '照一般訊息處理');
    assert.equal((await instancesOf(p.contactId)).length, 0);
  });

  it('發券訊息送不出時券作廢，對話留下紅色紀錄', async () => {
    const couponId = await coupon(T, '送不出');
    const l = await link(T, couponId, channels.lineA);
    const p = await person(channels.lineA, 'LINE');
    unreachable.add(p.conversationId);

    await run(channels.lineA, 'LINE', text(p.uid, claimPrefillText(l.code)));

    assert.equal((await instancesOf(p.contactId)).length, 0, '券作廢、名額歸還');
    assert.equal((await owner.couponClaimLink.findUnique({ where: { id: l.id } }))?.claimCount, 0);
    const note = await owner.message.findFirst({ where: { conversationId: p.conversationId, direction: 'OUTBOUND' } });
    const meta = note?.metadata as { deliveryFailed?: boolean; couponClaimFailed?: { reason?: string } };
    assert.equal(meta.deliveryFailed, true);
    assert.equal(meta.couponClaimFailed?.reason, 'DELIVERY_FAILED');
  });

  it('一般訊息照常處理', async () => {
    const p = await person(channels.lineA, 'LINE');
    await run(channels.lineA, 'LINE', text(p.uid, '請問 WEEKENDS 有營業嗎'));
    assert.equal(receivedFor(p.conversationId).length, 1);
    assert.equal(sentTo(p.conversationId).length, 0);
  });
});
