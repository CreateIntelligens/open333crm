/**
 * 規則發券（add-coupon-system design D16、D25～D27）：關鍵字回覆、加好友禮與既有自動化規則的「發送優惠券」。
 *
 * 與對話發券（apps/api coupon-inbox）相同的「保留 → 送出 → 確認／作廢」：
 *   1. 短交易：鎖券、確認券仍是進行中、建立券並記下發送中（deliveryPendingAt），立即提交
 *   2. 交易外：產生票券連結（Redis）、呼叫渠道送出發券訊息
 *   3. 送出成功：新交易清除發送中、貼領券標籤（contact.tagged 寫 outbox）、寫入券卡訊息；
 *      提交後推 message.new 與 coupon.instance.updated
 *   4. 送出失敗：新交易作廢這張券並歸還序號；對話留下紅色的送出失敗紀錄
 * 程式在第 2 步中途結束時，券卡在發送中，由 API 的 coupon-stale-pending-issue 排程在 5 分鐘後作廢。
 * 發券訊息最多送出一次：動作已由 automation_action 認領，重試不會再送。
 *
 * 沒有呼叫渠道就決定不發時（券找不到、不是進行中、名額或序號用完、已達每人上限、沒有渠道身分、
 * 渠道不支援），在對話留下灰色的系統訊息（失敗不可以只寫 log）；名額類原因可另外回覆顧客一段文字。
 *
 * ⚠️ workers 走 BYPASSRLS 連線，RLS 不會兜底：每個查詢都自帶 tenantId。
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { AUTOMATION_DELIVERY_CHANNEL_TYPES, type ChannelPlugin } from '@open333crm/channel-plugins';
import {
  buildCouponMessage,
  confirmPendingInstance,
  couponLiffConfig,
  couponLinkUrl,
  couponSourceName,
  dispatchOutboxRows,
  issueInstances,
  issueWalletToken,
  logger,
  voidPendingInstance,
  writeOutbox,
  type IssueSkipReason,
  type OutboxRow,
  type WalletTokenStore,
} from '@open333crm/core';
import { COUPON_ISSUED_VIA, type CouponIssuedVia } from '@open333crm/shared';
import { deliverToChannelFromWorker, sendToChannelFromWorker, type DeliverPayload } from './channel-delivery.js';
import { publishSocketEvent } from './socket-bridge.js';

/** 沒有發出券的原因代碼（design D25） */
export type RuleCouponFailureReason =
  | 'COUPON_NOT_FOUND'
  | 'COUPON_INACTIVE'
  | 'PER_CONTACT_LIMIT_REACHED'
  | 'TOTAL_LIMIT_REACHED'
  | 'CODES_EXHAUSTED'
  | 'NO_CHANNEL_IDENTITY'
  | 'CHANNEL_NOT_SUPPORTED'
  | 'DELIVERY_FAILED';

export const RULE_COUPON_FAILURE_TEXT: Record<RuleCouponFailureReason, string> = {
  COUPON_NOT_FOUND: '券已刪除或不屬於這個租戶',
  COUPON_INACTIVE: '券不是進行中（已暫停或已結束）',
  PER_CONTACT_LIMIT_REACHED: '顧客已達每人領取上限',
  TOTAL_LIMIT_REACHED: '發行總量已發完',
  CODES_EXHAUSTED: '序號包的序號已用完',
  NO_CHANNEL_IDENTITY: '這位聯絡人沒有這個渠道的身分',
  CHANNEL_NOT_SUPPORTED: '這個渠道不支援自動發券',
  DELIVERY_FAILED: '渠道拒收',
};

/** 有填「發不出時回覆顧客」時，只有這些原因回覆：顧客收得到、而且回覆有意義 */
const REPLYABLE_REASONS: ReadonlySet<RuleCouponFailureReason> = new Set([
  'COUPON_INACTIVE',
  'PER_CONTACT_LIMIT_REACHED',
  'TOTAL_LIMIT_REACHED',
  'CODES_EXHAUSTED',
]);

/** core issueInstances 的略過原因 → 規則發券的原因代碼 */
const SKIP_REASON: Record<IssueSkipReason, RuleCouponFailureReason> = {
  PER_CONTACT_LIMIT_REACHED: 'PER_CONTACT_LIMIT_REACHED',
  TOTAL_LIMIT_REACHED: 'TOTAL_LIMIT_REACHED',
  CODES_EXHAUSTED: 'CODES_EXHAUSTED',
  // 下列在券的鎖內幾乎不會發生；對商家而言都是「這張券沒有可配發的序號」
  SHARED_CODE_MISSING: 'CODES_EXHAUSTED',
  CODE_GENERATION_FAILED: 'CODES_EXHAUSTED',
  CODE_ALLOCATION_CONFLICT: 'CODES_EXHAUSTED',
  // 聯絡人在發券途中被刪除或合併
  CONTACT_NOT_FOUND: 'NO_CHANNEL_IDENTITY',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 觸發事件 → 發放方式代碼（design D27、D32） */
export function couponIssuedViaForTrigger(trigger: string | null | undefined): CouponIssuedVia {
  if (trigger === 'keyword.matched') return COUPON_ISSUED_VIA.KEYWORD;
  if (trigger === 'contact.followed') return COUPON_ISSUED_VIA.FOLLOW;
  return COUPON_ISSUED_VIA.AUTOMATION;
}

export interface RuleCouponIssueInput {
  tenantId: string;
  conversationId: string;
  /** 事件帶的聯絡人，只用來記錄與對話聯絡人不一致的情況；收券人一律是對話的聯絡人 */
  contactId?: string | null;
  couponId: string;
  /** 「發不出時回覆顧客」：名額類原因沒有發券時送給顧客的文字，空白表示不回覆 */
  failureText?: string | null;
  /** 發券的規則：issuedRefId 存規則 id，來源名稱存發券當下的規則名稱 */
  rule: { id: string | null; name: string | null };
  /** keyword、follow 或 automation（couponIssuedViaForTrigger） */
  issuedVia: CouponIssuedVia;
  /** 帶回覆權杖與收到時間時，LINE 在 30 秒內以回覆方式送出，否則改用 push */
  delivery?: DeliverPayload['delivery'];
  pluginRegistry: Map<string, ChannelPlugin>;
  /** 票券連結的網址前綴；預設為 WEB_BASE_URL */
  webBaseUrl?: string;
  now?: () => number;
}

export type RuleCouponIssueResult =
  | { issued: true; instanceId: string; messageId: string }
  | { issued: false; reason: RuleCouponFailureReason };

interface ConversationForIssue {
  id: string;
  tenantId: string;
  contactId: string | null;
  channelId: string;
  channel: { channelType: string; settings: unknown };
}

/**
 * 規則發券。給加好友禮重用：傳入 issuedVia 'follow'、加好友事件的回覆權杖與收到時間即可。
 * 不丟出可預期的失敗（回傳 issued: false 與原因，對話已留下紀錄）；資料庫錯誤照常丟出。
 */
export async function issueCouponForRule(
  prisma: PrismaClient,
  redis: IORedis,
  input: RuleCouponIssueInput,
): Promise<RuleCouponIssueResult> {
  const { tenantId } = input;
  const now = input.now ?? Date.now;

  const conv = (await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId },
    select: { id: true, tenantId: true, contactId: true, channelId: true, channel: { select: { channelType: true, settings: true } } },
  })) as ConversationForIssue | null;
  if (!conv) {
    // 沒有對話就沒有地方留下紀錄
    logger.warn('[automation] issue_coupon skipped: conversation not found in tenant', { tenantId, conversationId: input.conversationId });
    return { issued: false, reason: 'NO_CHANNEL_IDENTITY' };
  }
  // 收券人以對話的聯絡人為準：訊息送到對話聯絡人的渠道身分。事件帶的 contactId 可能已過期
  // （例如事件排入後聯絡人被合併、對話搬到保留的聯絡人），用它會讓券與訊息落在不同人身上（PR #364 審查）
  const contactId = conv.contactId;
  if (input.contactId && conv.contactId && input.contactId !== conv.contactId) {
    logger.info('[automation] issue_coupon: 事件的聯絡人與對話的聯絡人不同，以對話為準', {
      tenantId, conversationId: conv.id, eventContactId: input.contactId, contactId: conv.contactId,
    });
  }

  const coupon = UUID_RE.test(input.couponId)
    ? await prisma.coupon.findFirst({ where: { id: input.couponId, tenantId } })
    : null;
  const fail = async (reason: RuleCouponFailureReason) => {
    await recordNotIssued(prisma, redis, conv, input, coupon?.name ?? null, reason);
    if (input.failureText?.trim() && REPLYABLE_REASONS.has(reason)) {
      // 顧客收得到的回覆；送不出時 deliverToChannelFromWorker 會留下送出失敗紀錄
      await deliverToChannelFromWorker(prisma, redis, input.pluginRegistry, conv.id, {
        contentType: 'text',
        content: { text: input.failureText.trim() },
        delivery: input.delivery,
      });
    }
    return { issued: false as const, reason };
  };

  if (!coupon) return fail('COUPON_NOT_FOUND');
  // workers 沒有網站客服等渠道的外掛，發券訊息一定送不出（design D26）
  if (!AUTOMATION_DELIVERY_CHANNEL_TYPES.includes(conv.channel.channelType)) return fail('CHANNEL_NOT_SUPPORTED');
  if (coupon.status !== 'ACTIVE') return fail('COUPON_INACTIVE');
  const identity = contactId
    ? await prisma.channelIdentity.findFirst({
      where: { contactId, channelId: conv.channelId, contact: { tenantId } },
      select: { id: true },
    })
    : null;
  if (!contactId || !identity) return fail('NO_CHANNEL_IDENTITY');

  // 1. 保留：鎖住這張券、確認仍是進行中，建立發送中的券
  const reserved = await prisma.$transaction(async (tx) => {
    // 先鎖再讀狀態：讀到進行中之後才被暫停的話，暫停會等這次保留提交（issueInstances 內同一把鎖，可重入）
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${coupon.id}, 0))`;
    const locked = await tx.coupon.findFirst({ where: { id: coupon.id, tenantId } });
    if (!locked) return { ok: false as const, reason: 'COUPON_NOT_FOUND' as const };
    if (locked.status !== 'ACTIVE') return { ok: false as const, reason: 'COUPON_INACTIVE' as const };
    const outcome = await issueInstances(tx, {
      tenantId,
      coupon: locked,
      contactIds: [contactId],
      issuedVia: input.issuedVia,
      issuedRefId: input.rule.id,
      issuedSourceName: input.rule.name || couponSourceName(input.issuedVia),
    });
    const instance = outcome.issued[0];
    if (!instance) {
      const skip = outcome.skipped[0]?.reason;
      return { ok: false as const, reason: skip ? SKIP_REASON[skip] : ('CODES_EXHAUSTED' as const) };
    }
    await tx.couponInstance.updateMany({
      where: { id: instance.id, tenantId },
      data: { deliveryPendingAt: new Date(now()) },
    });
    const created = await tx.couponInstance.findFirst({ where: { id: instance.id, tenantId }, select: { expiresAt: true } });
    return { ok: true as const, instanceId: instance.id, coupon: locked, expiresAt: created?.expiresAt ?? null };
  });
  if (!reserved.ok) return fail(reserved.reason);

  const voidReserved = () => prisma.$transaction((tx) => voidPendingInstance(tx, tenantId, reserved.instanceId));
  const failureLine = notIssuedText(input.rule.name, reserved.coupon.name, 'DELIVERY_FAILED');
  const failureMetadata = { couponIssueFailed: failureDetail(input, 'DELIVERY_FAILED') };

  // 2. 交易外：票券連結（Redis）與送出
  let text: string;
  try {
    const token = await issueWalletToken(redis as unknown as WalletTokenStore, {
      tenantId,
      contactId,
      channelIdentityId: identity.id,
      channelId: conv.channelId,
      conversationId: conv.id,
      instanceId: reserved.instanceId,
    }, now);
    const webBaseUrl = input.webBaseUrl ?? (process.env.WEB_BASE_URL || 'http://localhost:3000');
    // 渠道設定了 LIFF 與 Login channel 時，連結走 LIFF（design D20）
    text = buildCouponMessage({
      couponName: reserved.coupon.name,
      url: couponLinkUrl(webBaseUrl, token, couponLiffConfig(conv.channel.settings)),
    });
  } catch (err) {
    logger.error('[automation] issue_coupon: 無法產生票券連結，券作廢', { tenantId, instanceId: reserved.instanceId, err });
    await voidReserved();
    await recordFailureNotice(prisma, redis, conv, failureLine, failureMetadata, `無法產生票券連結：${(err as Error).message}`);
    return { issued: false, reason: 'DELIVERY_FAILED' };
  }

  const sent = await sendToChannelFromWorker(
    prisma,
    redis,
    input.pluginRegistry,
    conv.id,
    { contentType: 'text', content: { text }, delivery: input.delivery },
    { skipSuccessRecord: true, failureContent: { text: failureLine }, failureMetadata },
  );
  if (!sent.ok) {
    // 4. 送不出：作廢並歸還名額與序號；領券標籤與券卡都還沒寫，不必撤回
    await voidReserved();
    if (!sent.recorded) await recordFailureNotice(prisma, redis, conv, failureLine, failureMetadata, sent.error);
    return { issued: false, reason: 'DELIVERY_FAILED' };
  }

  // 3. 確認：清除發送中、貼標、寫入券卡訊息
  const couponCard = {
    instanceId: reserved.instanceId,
    couponId: reserved.coupon.id,
    name: reserved.coupon.name,
    couponType: reserved.coupon.couponType,
    discountAmount: reserved.coupon.discountAmount,
    discountPercent: reserved.coupon.discountPercent,
    giftName: reserved.coupon.giftName,
    exchangeItem: reserved.coupon.exchangeItem,
    minSpend: reserved.coupon.minSpend,
    expiresAt: reserved.expiresAt?.toISOString() ?? null,
    issuedByName: null,
  };
  const metadata = { source: 'automation', ruleId: input.rule.id, ruleName: input.rule.name };
  const confirmed = await prisma.$transaction(async (tx) => {
    const result = await confirmPendingInstance(tx, {
      tenantId,
      instanceId: reserved.instanceId,
      contactId,
      coupon: reserved.coupon,
      now: now(),
    });
    if (!result.confirmed) return null;
    let outboxRow: OutboxRow | null = null;
    if (result.tag) {
      // contact.tagged 與確認一起 commit（event-delivery「workers 的事件與資料一起 commit」）
      outboxRow = await writeOutbox(tx, {
        tenantId,
        kind: 'event',
        name: 'contact.tagged',
        payload: { contactId, tagId: result.tag.tagId, tagName: result.tag.tagName, source: 'system' },
      });
    }
    const message = await tx.message.create({
      data: {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType: 'text',
        // 送給顧客的是文字與票券連結；content.coupon 讓後台畫成券卡（與對話發券相同格式）
        content: { text, coupon: couponCard },
        channelMsgId: sent.channelMsgId,
        metadata,
        createdAt: sent.sentAt,
      },
    });
    await tx.conversation.updateMany({ where: { id: conv.id, tenantId }, data: { lastMessageAt: sent.sentAt } });
    return { message, outboxRow };
  });

  if (!confirmed) {
    // 送出途中超過 5 分鐘被排程作廢：顧客收到的連結會顯示券已失效
    await recordNotIssued(prisma, redis, conv, input, reserved.coupon.name, 'DELIVERY_FAILED', '發送逾時，券已作廢');
    return { issued: false, reason: 'DELIVERY_FAILED' };
  }

  if (confirmed.outboxRow) {
    // 快路徑；失敗時資料列留在 outbox，由 API 的 outbox-relay 補送
    await dispatchOutboxRows(prisma, [confirmed.outboxRow]).catch((err: unknown) =>
      logger.warn('[automation] outbox dispatch failed (contact.tagged)', err));
  }
  await publishMessageNew(redis, conv, {
    id: confirmed.message.id,
    contentType: 'text',
    content: { text, coupon: couponCard },
    metadata,
    createdAt: sent.sentAt,
  });
  // 聯絡人的「已發優惠券」區塊即時重新載入（design D23、D27）：workers 不能用 fastify.io，走 Redis 橋接
  await publishSocketEvent(redis, `tenant:${tenantId}`, 'coupon.instance.updated', {
    instanceId: reserved.instanceId,
    contactId,
    change: 'issued',
  });
  logger.info(`[automation] issue_coupon: 發出券 ${reserved.instanceId}（${input.issuedVia}，規則 ${input.rule.id ?? '-'}）`);
  return { issued: true, instanceId: reserved.instanceId, messageId: confirmed.message.id };
}

function failureDetail(input: RuleCouponIssueInput, reason: RuleCouponFailureReason) {
  return { ruleId: input.rule.id, ruleName: input.rule.name, couponId: input.couponId, reason };
}

function notIssuedText(ruleName: string | null, couponName: string | null, reason: RuleCouponFailureReason, detail?: string) {
  const rule = ruleName ? `規則「${ruleName}」` : '自動化規則';
  const coupon = couponName ? `優惠券「${couponName}」` : '優惠券';
  return `${rule}沒有發出${coupon}：${detail ?? RULE_COUPON_FAILURE_TEXT[reason]}`;
}

/** 沒有呼叫渠道就決定不發：灰色的系統訊息（MessageBubble 對 SYSTEM 且非送出失敗的訊息畫成灰色提示） */
async function recordNotIssued(
  prisma: PrismaClient,
  redis: IORedis,
  conv: ConversationForIssue,
  input: RuleCouponIssueInput,
  couponName: string | null,
  reason: RuleCouponFailureReason,
  detail?: string,
) {
  const content = { text: notIssuedText(input.rule.name, couponName, reason, detail) };
  const metadata = { source: 'automation', couponIssueFailed: failureDetail(input, reason) };
  const message = await prisma.message.create({
    data: { conversationId: conv.id, direction: 'OUTBOUND', senderType: 'SYSTEM', contentType: 'text', content, metadata },
  });
  logger.warn(`[automation] issue_coupon 沒有發出（${reason}）`, { tenantId: conv.tenantId, conversationId: conv.id, couponId: input.couponId });
  await publishMessageNew(redis, conv, { id: message.id, contentType: 'text', content, metadata, createdAt: message.createdAt });
}

/** 已保留後才失敗、而送出流程沒有留下紀錄時（例如產生票券連結失敗）：紅色的送出失敗紀錄 */
async function recordFailureNotice(
  prisma: PrismaClient,
  redis: IORedis,
  conv: ConversationForIssue,
  text: string,
  failureMetadata: Record<string, unknown>,
  error: string,
) {
  const content = { text };
  const metadata = {
    source: 'automation',
    ...failureMetadata,
    deliveryFailed: true,
    deliveryError: error.slice(0, 500),
    channelType: conv.channel.channelType,
  };
  const message = await prisma.message.create({
    data: { conversationId: conv.id, direction: 'OUTBOUND', senderType: 'SYSTEM', contentType: 'text', content, metadata },
  });
  await publishMessageNew(redis, conv, { id: message.id, contentType: 'text', content, metadata, createdAt: message.createdAt });
}

async function publishMessageNew(
  redis: IORedis,
  conv: { id: string; tenantId: string },
  m: { id: string; contentType: string; content: unknown; metadata: unknown; createdAt: Date },
) {
  const payload = {
    conversationId: conv.id,
    message: {
      id: m.id,
      conversationId: conv.id,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: m.contentType,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt.toISOString(),
      sender: null,
    },
  };
  await publishSocketEvent(redis, `conversation:${conv.id}`, 'message.new', payload);
  await publishSocketEvent(redis, `tenant:${conv.tenantId}`, 'message.new', payload);
}
