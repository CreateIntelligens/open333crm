/**
 * 對話發券（add-coupon-system A11、design D14）：發券面板資料、發券、發送鍵查詢、聯絡人已發券。
 *
 * 發券在一個交易內完成：鎖券（core issueInstances）→ 檢查對話範圍與回覆期限 → 建券 → 送出訊息
 * → 寫入對話訊息。訊息送不出就整筆回滾，券、序號與標籤都不留下，座席看到的「券未發出」才是真的。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { buildCouponMessage, issueWalletToken, walletLinkUrl } from '@open333crm/core';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { getConfig } from '../../config/env.js';
import { withTenant, type TenantDb } from '../../lib/tenant-db.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { issueCouponsInTx } from './coupon-issue.service.js';
import { CouponValidationError } from './coupon.service.js';

export interface InboxIssueDeps {
  store: BindingStore;
  now?: () => number;
  /** 票券連結的網址前綴；預設為 WEB_BASE_URL */
  webBaseUrl?: string;
  /** 在發券交易內送出發券訊息；預設走 deliverToChannel（測試可替換） */
  deliver?: (
    tx: Prisma.TransactionClient,
    params: { tenantId: string; conversationId: string; text: string },
  ) => Promise<{ sent: boolean; reason?: string }>;
  /** 渠道的訊息回覆期限（小時）；預設由渠道外掛提供 */
  windowHoursFor?: (channelType: string) => number | undefined;
  /** 發券成功後推播對話新訊息（API 傳 fastify.io 的 emit） */
  emit?: (room: string, event: string, data: unknown) => void;
}

const nowOf = (deps: Pick<InboxIssueDeps, 'now'>) => (deps.now ?? Date.now)();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** 補償紀錄的期間 */
export const HISTORY_DAYS = 90;
/** 固定效期在幾天內結束時提示即將到期 */
export const EXPIRING_DAYS = 3;
/** 發送鍵結果的保存時間 */
const REQUEST_KEEP_MS = 10 * 60 * 1000;
/** 交易內要等渠道 API 回應，延長交易逾時（預設 5 秒） */
const ISSUE_TX_TIMEOUT_MS = 20_000;

export type IssueBlockReason = 'CONVERSATION_CLOSED' | 'REPLY_WINDOW_EXPIRED';
export type IssuedStatus = 'SENT' | 'VIEWED' | 'USED' | 'EXPIRED' | 'REVOKED';

export interface IssuableCoupon {
  id: string;
  name: string;
  couponType: string | null;
  discountAmount: number | null;
  discountPercent: number | null;
  percentCap: number | null;
  giftName: string | null;
  giftQty: number | null;
  exchangeItem: string | null;
  minSpend: number | null;
  validityMode: string | null;
  startAt: Date | null;
  endAt: Date | null;
  afterClaimDays: number | null;
  afterOpenMinutes: number | null;
  perContactLimit: number;
  /** 此顧客領過的張數（已過期、已撤回不算） */
  receivedCount: number;
  limitReached: boolean;
  lastClaimedAt: Date | null;
  lastRedeemedAt: Date | null;
  /** 固定效期且 3 天內結束時為結束時間，否則 null */
  expiringAt: Date | null;
  /** 有最低消費門檻（可帶動消費） */
  drivesSpend: boolean;
}

export interface CompensationHistory {
  count: number;
  /** 元折抵券的面額合計 */
  totalAmount: number;
  latest: { couponName: string; issuedByName: string | null; issuedAt: Date; status: IssuedStatus } | null;
}

export interface IssueContext {
  conversation: {
    id: string;
    status: string;
    assignedToId: string | null;
    contactId: string;
    contactName: string;
    channelType: string;
  };
  blocked: { reason: IssueBlockReason; windowHours?: number } | null;
  history: CompensationHistory;
  coupons: IssuableCoupon[];
}

// ── 判定規則（純函式） ─────────────────────────────────────────────────────

/** 佔每人上限的狀態：領過就算（含已使用），已過期與已撤回不算（design D14） */
const HELD_STATUSES = ['ISSUED', 'CLAIMED', 'OPENED', 'REDEEMED'] as const;

/** 已發券的狀態：已使用 → 已過期 → 已撤回 → 已領取（顧客開啟過連結）→ 已發送 */
export function issuedStatus(
  i: { status: string; viewedAt: Date | null; expiresAt: Date | null },
  now: number,
): IssuedStatus {
  if (i.status === 'REDEEMED') return 'USED';
  if (i.status === 'EXPIRED' || (i.expiresAt && i.expiresAt.getTime() <= now)) return 'EXPIRED';
  if (i.status === 'REVOKED') return 'REVOKED';
  if (i.viewedAt) return 'VIEWED';
  return 'SENT';
}

/** 有消費門檻的券排前面，其次依建立時間（新到舊）保持穩定 */
export function sortIssuable<T extends { drivesSpend: boolean }>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(b.drivesSpend) - Number(a.drivesSpend));
}

function expiringAt(c: { validityMode: string | null; endAt: Date | null }, now: number): Date | null {
  if (c.validityMode !== 'FIXED' || !c.endAt) return null;
  const left = c.endAt.getTime() - now;
  return left > 0 && left <= EXPIRING_DAYS * DAY_MS ? c.endAt : null;
}

/** 顧客最後一則訊息超過渠道回覆期限時回傳期限（小時），否則 null */
async function expiredWindow(
  tx: TenantDb,
  conversationId: string,
  windowHours: number | undefined,
  now: number,
): Promise<number | null> {
  if (!windowHours) return null;
  const last = await tx.message.findFirst({
    where: { conversationId, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!last) return windowHours;
  return now - last.createdAt.getTime() > windowHours * HOUR_MS ? windowHours : null;
}

const defaultWindowHours = (channelType: string) => getChannelPlugin(channelType)?.messagingWindowHours;

// ── 發券面板資料 ───────────────────────────────────────────────────────────

const COUPON_FIELDS = {
  id: true, name: true, couponType: true, discountAmount: true, discountPercent: true, percentCap: true,
  giftName: true, giftQty: true, exchangeItem: true, minSpend: true, validityMode: true, startAt: true,
  endAt: true, afterClaimDays: true, afterOpenMinutes: true, perContactLimit: true,
} as const;

async function loadConversation(tx: TenantDb, tenantId: string, conversationId: string) {
  return tx.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true, status: true, assignedToId: true, contactId: true, channelId: true, channelType: true,
      contact: { select: { displayName: true } },
    },
  });
}

export async function getIssueContext(
  prisma: PrismaClient,
  deps: InboxIssueDeps,
  input: { tenantId: string; conversationId: string },
): Promise<IssueContext | null> {
  const { tenantId } = input;
  const now = nowOf(deps);
  return withTenant(prisma, tenantId, async (tx) => {
    const conv = await loadConversation(tx, tenantId, input.conversationId);
    if (!conv?.contactId) return null;
    const contactId = conv.contactId;

    let blocked: IssueContext['blocked'] = null;
    if (conv.status === 'CLOSED') {
      blocked = { reason: 'CONVERSATION_CLOSED' };
    } else {
      const hours = await expiredWindow(tx, conv.id, (deps.windowHoursFor ?? defaultWindowHours)(conv.channelType), now);
      if (hours) blocked = { reason: 'REPLY_WINDOW_EXPIRED', windowHours: hours };
    }

    const coupons = await tx.coupon.findMany({
      where: { tenantId, purpose: 'SERVICE', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: COUPON_FIELDS,
    });
    const held = coupons.length
      ? await tx.couponInstance.findMany({
        where: { tenantId, contactId, couponId: { in: coupons.map((c) => c.id) }, status: { in: [...HELD_STATUSES] } },
        orderBy: { issuedAt: 'desc' },
        select: { couponId: true, claimedAt: true, issuedAt: true, redeemedAt: true },
      })
      : [];

    const issuable = coupons.map((c): IssuableCoupon => {
      const mine = held.filter((h) => h.couponId === c.id);
      const latest = mine[0];
      const lastRedeemed = mine.find((h) => h.redeemedAt);
      return {
        ...c,
        receivedCount: mine.length,
        limitReached: mine.length >= c.perContactLimit,
        lastClaimedAt: latest ? latest.claimedAt ?? latest.issuedAt : null,
        lastRedeemedAt: lastRedeemed?.redeemedAt ?? null,
        expiringAt: expiringAt(c, now),
        drivesSpend: (c.minSpend ?? 0) > 0,
      };
    });

    const since = new Date(now - HISTORY_DAYS * DAY_MS);
    const recent = await tx.couponInstance.findMany({
      where: { tenantId, contactId, issuedAt: { gte: since }, coupon: { tenantId, purpose: 'SERVICE' } },
      orderBy: { issuedAt: 'desc' },
      select: {
        status: true, viewedAt: true, expiresAt: true, issuedAt: true, issuedByName: true,
        coupon: { select: { name: true, couponType: true, discountAmount: true } },
      },
    });
    const first = recent[0];

    return {
      conversation: {
        id: conv.id,
        status: conv.status,
        assignedToId: conv.assignedToId,
        contactId,
        contactName: conv.contact?.displayName ?? '',
        channelType: conv.channelType,
      },
      blocked,
      history: {
        count: recent.length,
        totalAmount: recent.reduce(
          (sum, r) => sum + (r.coupon.couponType === 'DISCOUNT_AMOUNT' ? r.coupon.discountAmount ?? 0 : 0),
          0,
        ),
        latest: first
          ? { couponName: first.coupon.name, issuedByName: first.issuedByName, issuedAt: first.issuedAt, status: issuedStatus(first, now) }
          : null,
      },
      coupons: sortIssuable(issuable),
    };
  });
}

// ── 發券 ──────────────────────────────────────────────────────────────────

export type InboxIssueFailure =
  | 'NOT_FOUND'
  | 'COUPON_NOT_ISSUABLE'
  | 'PER_CONTACT_LIMIT_REACHED'
  | 'COUPON_DELIVERY_FAILED'
  | 'CONVERSATION_OUT_OF_SCOPE'
  | 'REPLY_WINDOW_EXPIRED'
  | 'ISSUE_IN_PROGRESS'
  /** 同一個發送鍵用在不同的券或對話（前端每次確認都產生新鍵，正常操作不會發生） */
  | 'KEY_REUSED'
  | 'ISSUE_FAILED';

export type InboxIssueResult =
  | { ok: true; instanceId: string; code: string; couponId: string; couponName: string; messageId: string }
  | { ok: false; reason: InboxIssueFailure; details?: { issuedByName?: string | null; issuedAt?: string } };

export interface InboxIssueInput {
  tenantId: string;
  conversationId: string;
  couponId: string;
  agentId: string;
  agentName?: string;
  /** 座席開啟面板時看到的負責人；與目前不同代表發送途中被轉派 */
  expectedAssigneeId: string | null;
  /** 發送鍵：同一個鍵只發出一張券 */
  requestKey: string;
}

/** 交易內判定失敗：丟出以回滾，外層轉成結果 */
class IssueAbort extends Error {
  constructor(readonly result: Extract<InboxIssueResult, { ok: false }>) {
    super(result.reason);
  }
}

/** 序號用盡、總量已滿等，座席看到的都是「此券已停止發放」 */
const NOT_ISSUABLE_SKIPS = new Set(['TOTAL_LIMIT_REACHED', 'CODES_EXHAUSTED', 'SHARED_CODE_MISSING']);

const requestKeyOf = (tenantId: string, requestKey: string) => `coupon:inbox-issue:${tenantId}:${requestKey}`;

export async function issueInConversation(
  prisma: PrismaClient,
  deps: InboxIssueDeps,
  input: InboxIssueInput,
): Promise<InboxIssueResult> {
  const key = requestKeyOf(input.tenantId, input.requestKey);
  // 發送鍵綁定這次發券的內容：同一個鍵換成別的券或對話，不回傳上一次的結果
  const fingerprint = `${input.conversationId}:${input.couponId}`;
  const claimed = await deps.store.set(key, JSON.stringify({ state: 'pending', for: fingerprint }), 'PX', REQUEST_KEEP_MS, 'NX');
  if (claimed !== 'OK') {
    const existing = await readStored(deps.store, key);
    if (existing && existing.for !== fingerprint) return { ok: false, reason: 'KEY_REUSED' };
    return existing?.state === 'done' && existing.result ? existing.result : { ok: false, reason: 'ISSUE_IN_PROGRESS' };
  }

  let result: InboxIssueResult;
  try {
    result = await runIssue(prisma, deps, input);
  } catch (err) {
    // 非預期錯誤：交易已回滾、券未發出，清掉發送鍵讓座席可以重送
    await deps.store.getdel(key);
    throw err;
  }
  // 以 XX 直接把「處理中」換成結果：先刪再寫會留下空窗，重送的請求會趁空窗再發一次
  await deps.store.set(key, JSON.stringify({ state: 'done', for: fingerprint, result }), 'PX', REQUEST_KEEP_MS, 'XX');
  return result;
}

async function runIssue(prisma: PrismaClient, deps: InboxIssueDeps, input: InboxIssueInput): Promise<InboxIssueResult> {
  const { tenantId } = input;
  const now = nowOf(deps);
  const deliver = deps.deliver ?? defaultDeliver;

  let committed: { result: Extract<InboxIssueResult, { ok: true }>; message: Prisma.MessageGetPayload<object> };
  try {
    committed = await withTenant(prisma, tenantId, async (tx) => {
      const conv = await loadConversation(tx, tenantId, input.conversationId);
      const identity = conv?.contactId
        ? await tx.channelIdentity.findFirst({
          where: { contactId: conv.contactId, channelId: conv.channelId },
          select: { id: true, channelId: true },
        })
        : null;
      const coupon = await tx.coupon.findFirst({
        where: { id: input.couponId, tenantId },
        select: { ...COUPON_FIELDS, purpose: true, status: true },
      });
      if (!conv?.contactId || !identity || !coupon) throw new IssueAbort({ ok: false, reason: 'NOT_FOUND' });
      const contactId = conv.contactId;

      if (conv.status === 'CLOSED' || conv.assignedToId !== input.expectedAssigneeId) {
        throw new IssueAbort({ ok: false, reason: 'CONVERSATION_OUT_OF_SCOPE' });
      }
      const window = await expiredWindow(tx, conv.id, (deps.windowHoursFor ?? defaultWindowHours)(conv.channelType), now);
      if (window) throw new IssueAbort({ ok: false, reason: 'REPLY_WINDOW_EXPIRED' });
      if (coupon.purpose !== 'SERVICE' || coupon.status !== 'ACTIVE') {
        throw new IssueAbort({ ok: false, reason: 'COUPON_NOT_ISSUABLE' });
      }

      let outcome;
      try {
        outcome = await issueCouponsInTx(tx, tenantId, coupon.id, {
          contactIds: [contactId],
          issuedVia: 'inbox',
          issuedRefId: input.agentId,
          issuedByName: input.agentName,
          requireClaim: false,
        });
      } catch (err) {
        // 讀到 ACTIVE 之後、鎖住之前被暫停或結束
        if (err instanceof CouponValidationError) throw new IssueAbort({ ok: false, reason: 'COUPON_NOT_ISSUABLE' });
        throw err;
      }
      const instance = outcome.issued[0];
      if (!instance) {
        const reason = outcome.skipped[0]?.reason;
        if (reason === 'PER_CONTACT_LIMIT_REACHED') {
          const last = await tx.couponInstance.findFirst({
            where: { tenantId, couponId: coupon.id, contactId, status: { in: [...HELD_STATUSES] } },
            orderBy: { issuedAt: 'desc' },
            select: { issuedByName: true, issuedAt: true },
          });
          throw new IssueAbort({
            ok: false,
            reason,
            details: { issuedByName: last?.issuedByName ?? null, issuedAt: last?.issuedAt.toISOString() },
          });
        }
        throw new IssueAbort({ ok: false, reason: reason && NOT_ISSUABLE_SKIPS.has(reason) ? 'COUPON_NOT_ISSUABLE' : 'ISSUE_FAILED' });
      }

      const token = await issueWalletToken(deps.store, {
        tenantId,
        contactId,
        channelIdentityId: identity.id,
        channelId: identity.channelId,
        conversationId: conv.id,
        instanceId: instance.id,
      }, deps.now);
      const text = buildCouponMessage({
        couponName: coupon.name,
        url: walletLinkUrl(deps.webBaseUrl ?? getConfig().WEB_BASE_URL, token),
      });
      const delivery = await deliver(tx, { tenantId, conversationId: conv.id, text });
      if (!delivery.sent) throw new IssueAbort({ ok: false, reason: 'COUPON_DELIVERY_FAILED' });

      const created = await tx.couponInstance.findUnique({ where: { id: instance.id }, select: { expiresAt: true } });
      const message = await createCouponMessage(tx, {
        tenantId,
        conversationId: conv.id,
        agentId: input.agentId,
        text,
        coupon: {
          instanceId: instance.id,
          couponId: coupon.id,
          name: coupon.name,
          couponType: coupon.couponType,
          discountAmount: coupon.discountAmount,
          discountPercent: coupon.discountPercent,
          giftName: coupon.giftName,
          exchangeItem: coupon.exchangeItem,
          minSpend: coupon.minSpend,
          expiresAt: created?.expiresAt?.toISOString() ?? null,
          issuedByName: input.agentName ?? null,
        },
        now: new Date(now),
      });
      return {
        result: {
          ok: true as const,
          instanceId: instance.id,
          code: instance.code,
          couponId: coupon.id,
          couponName: coupon.name,
          messageId: message.id,
        },
        message,
      };
    }, { timeout: ISSUE_TX_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof IssueAbort) return err.result;
    throw err;
  }

  // 已提交才推播，避免座席看到之後被回滾的訊息
  if (deps.emit) {
    const payload = { conversationId: input.conversationId, message: socketMessage(committed.message) };
    deps.emit(`conversation:${input.conversationId}`, 'message.new', payload);
    deps.emit(`tenant:${tenantId}`, 'message.new', payload);
  }
  return committed.result;
}

/** 預設送出：走既有 deliverToChannel；座席主動發券時 replyToken 多半已失效，固定 push（design D7） */
async function defaultDeliver(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; conversationId: string; text: string },
): Promise<{ sent: boolean }> {
  const sent = await deliverToChannel(tx, params.conversationId, {
    contentType: 'text',
    content: { text: params.text, strategy: 'push' },
  });
  return { sent };
}

/** 對話中的發券訊息：送給顧客的是文字與票券連結；content.coupon 讓後台畫成券卡 */
async function createCouponMessage(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; conversationId: string; agentId: string; text: string; coupon: Record<string, unknown>; now: Date },
) {
  const sequence = (await tx.message.count({ where: { conversationId: params.conversationId } })) + 1;
  const message = await tx.message.create({
    data: {
      conversationId: params.conversationId,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      senderId: params.agentId,
      contentType: 'text',
      content: { text: params.text, coupon: params.coupon } as Prisma.InputJsonValue,
      sequence,
      isRead: true,
      createdAt: params.now,
    },
    include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
  });
  await tx.conversation.updateMany({
    where: { id: params.conversationId, tenantId: params.tenantId },
    data: { lastMessageAt: params.now },
  });
  return message;
}

function socketMessage(m: Prisma.MessageGetPayload<object> & { sender?: unknown }) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    senderType: m.senderType,
    senderId: m.senderId,
    contentType: m.contentType,
    content: m.content,
    type: m.contentType,
    payload: m.content,
    metadata: m.metadata,
    createdAt: m.createdAt.toISOString(),
    sequence: m.sequence,
    sender: m.sender,
  };
}

// ── 發送鍵查詢 ─────────────────────────────────────────────────────────────

export type IssueRequestState =
  | { state: 'pending' }
  | { state: 'done'; result: InboxIssueResult }
  | { state: 'unknown' };

interface StoredRequest {
  state: 'pending' | 'done';
  for?: string;
  result?: InboxIssueResult;
}

async function readStored(store: BindingStore, key: string): Promise<StoredRequest | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredRequest;
    return parsed.state === 'done' || parsed.state === 'pending' ? parsed : null;
  } catch {
    return null;
  }
}

async function readRequest(store: BindingStore, key: string): Promise<IssueRequestState> {
  const stored = await readStored(store, key);
  if (!stored) return { state: 'unknown' };
  return stored.state === 'done' && stored.result ? { state: 'done', result: stored.result } : { state: 'pending' };
}

/** 網路逾時後查詢這次發券的結果。鍵含租戶 id，查不到其他租戶的結果。 */
export function getIssueRequest(
  deps: Pick<InboxIssueDeps, 'store'>,
  tenantId: string,
  requestKey: string,
): Promise<IssueRequestState> {
  return readRequest(deps.store, requestKeyOf(tenantId, requestKey));
}

// ── 聯絡人已發券 ───────────────────────────────────────────────────────────

export interface IssuedCouponView {
  id: string;
  couponId: string;
  couponName: string;
  couponType: string | null;
  discountAmount: number | null;
  discountPercent: number | null;
  giftName: string | null;
  exchangeItem: string | null;
  issuedByName: string | null;
  issuedSourceName: string | null;
  issuedAt: Date;
  status: IssuedStatus;
}

/** 對話聯絡人收到的券，新到舊，最多 20 張；查無對話回傳 null */
export async function listIssuedCoupons(
  db: TenantDb,
  tenantId: string,
  conversationId: string,
  now: number = Date.now(),
): Promise<IssuedCouponView[] | null> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { contactId: true } });
  if (!conv) return null;
  if (!conv.contactId) return [];
  const rows = await db.couponInstance.findMany({
    where: { tenantId, contactId: conv.contactId },
    orderBy: { issuedAt: 'desc' },
    take: 20,
    select: {
      id: true, couponId: true, status: true, viewedAt: true, expiresAt: true, issuedAt: true,
      issuedByName: true, issuedSourceName: true,
      coupon: { select: { name: true, couponType: true, discountAmount: true, discountPercent: true, giftName: true, exchangeItem: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    couponId: r.couponId,
    couponName: r.coupon.name,
    couponType: r.coupon.couponType,
    discountAmount: r.coupon.discountAmount,
    discountPercent: r.coupon.discountPercent,
    giftName: r.coupon.giftName,
    exchangeItem: r.coupon.exchangeItem,
    issuedByName: r.issuedByName,
    issuedSourceName: r.issuedSourceName,
    issuedAt: r.issuedAt,
    status: issuedStatus(r, now),
  }));
}
