/**
 * 附券廣播（add-coupon-system design D29、D31）：每位收件人各得一張券與自己的票券連結。
 *
 * 這裡只放單一交易的步驟（收 TenantCtx，AGENTS.md 結構規則 2）；串接、渠道 API 與 Redis 在
 * broadcast-coupon.flow.ts，由排程在背景執行。每位收件人依序：
 *   1. 交易：保留（建立發送中的券＋收件紀錄 pending）——reserveRecipient
 *   2. 交易外：產生票券連結（Redis）、送出訊息（渠道 API，最多一次，不重試）
 *   3. 交易：帶連結的那則送達就確認（confirmRecipient），否則作廢並歸還名額（voidRecipient）
 *
 * 各步驟失敗時的去向：
 * | 步驟 | 失敗時資料在哪裡 | 誰補做 | 保證 |
 * |---|---|---|---|
 * | 1 保留 | 交易回滾，沒有券也沒有收件紀錄 | 管理者重新發送時再處理這位收件人 | 每人最多一張 |
 * | 2 送出 | 券在發送中、收件紀錄 pending | 送不出就在第 3 步作廢；程式中途結束時由券的排程在 5 分鐘後作廢 | 訊息最多送一次 |
 * | 3 確認 | 確認失敗重試三次，仍失敗時券留在發送中、收件紀錄標 DELIVERED_UNCONFIRMED | 券的排程作廢 | 不會重送 |
 *
 * 收件紀錄在第 1 步就寫入：同一則廣播重送時，已有收件紀錄的人不再發券或送訊息（含 pending）。
 */
import type { Prisma } from '@prisma/client';
import { COUPON_ISSUED_VIA } from '@open333crm/shared';
import { confirmPendingInstance, taipeiDateString, voidPendingInstance, type IssueSkipReason } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';
import { issueCoupons } from '../coupon/coupon-issue.service.js';
import { CouponValidationError } from '../coupon/coupon.service.js';
import { resolveContext } from './template-context.js';
import { extractVariables, type TemplateVariable } from './template-renderer.js';
import {
  FAILURE_REASON_MAX_LENGTH,
  allRecipientsFailedReason,
  alreadySendingError,
  createBroadcast,
  filterByMessagingWindow,
  resolveAudience,
} from './marketing.service.js';

/** 發送中超過這個時間沒有進度，視為中斷（程式在發送途中結束），可以重新發送 */
export const STALE_SENDING_MS = 5 * 60 * 1000;
/** 每處理幾位收件人更新一次進度（也讓 updatedAt 前進，表示仍在發送） */
export const PROGRESS_EVERY = 20;
/** 券詳情頁批次發放的人數上限（design D31） */
export const BATCH_ISSUE_MAX_RECIPIENTS = 1000;
/** 附券廣播素材裡代入票券連結的變數 */
export const COUPON_URL_VARIABLE = 'coupon.url';
/**
 * 立即執行附券廣播的佇列（API 行程消費，broadcast-coupon.worker.ts）。job data 是 CouponBroadcastJobData；
 * 每分鐘的排程（broadcast.scheduler.ts）仍是後備：job 沒送出或沒執行時，排程照樣發送
 */
export const COUPON_BROADCAST_QUEUE = 'coupon-broadcast';
export interface CouponBroadcastJobData {
  tenantId: string;
  broadcastId: string;
}
/**
 * 搶占前的錯誤（例如資料庫斷線）重試；搶占後的錯誤 runCouponBroadcast 已把廣播標成失敗，
 * 重試時搶不到（not_claimed），不會重複發送
 */
const COUPON_BROADCAST_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
};

const SENDABLE_STATUSES = ['draft', 'scheduled', 'failed'];

/** 收件人沒拿到券（不送訊息）的原因 */
export type RecipientSkipReason = IssueSkipReason | 'NO_CHANNEL_IDENTITY' | 'OUTSIDE_MESSAGING_WINDOW';
/** 收件人的券作廢（或沒有確認）的原因 */
export type RecipientFailReason =
  /** 第一則（或唯一一則）訊息送不出 */
  | 'DELIVERY_FAILED'
  /** 素材已送達，帶連結的發券文字送不出 */
  | 'COUPON_MESSAGE_FAILED'
  /** 票券連結產生失敗（Redis） */
  | 'LINK_FAILED'
  /** 訊息已送出，但券在確認前已被排程作廢 */
  | 'CONFIRM_TOO_LATE'
  /** 訊息已送出，但系統記錄失敗 */
  | 'DELIVERED_UNCONFIRMED'
  /** 上次發送中斷（保留券之後、確認之前程式結束），無法確定是否送達；不重送，券由排程作廢 */
  | 'INTERRUPTED';

const nowDate = (now?: number) => new Date(now ?? Date.now());

// ── 排入發送 ──────────────────────────────────────────────────────────────

/**
 * 附券廣播的「立即發送」：在背景馬上開始執行，不在 HTTP 請求內同步發送（design D29）。
 * 同一個交易寫進 outbox 一個立即執行的 job（commit 後送進 coupon-broadcast 佇列），不等每分鐘的排程；
 * 排程時間設為現在，job 沒有執行時由排程補發（change fix-coupon-broadcast-immediate-run）。
 * 草稿、已排程、失敗可以排入；發送中但超過 5 分鐘沒有進度的（程式中途結束）也可以重新排入，
 * 已有收件紀錄的人不會再拿到券。job 與排程誰先搶占（claimCouponBroadcast）誰發送，另一個不做事。
 */
export async function queueCouponBroadcast(ctx: TenantCtx, broadcastId: string, now: number = Date.now()) {
  const { tx, tenantId } = ctx;
  const broadcast = await tx.broadcast.findFirst({
    where: { id: broadcastId, tenantId },
    select: { id: true, status: true, couponId: true },
  });
  if (!broadcast) throw new AppError(notFound('broadcast'), 'NOT_FOUND', 404);
  if (!broadcast.couponId) throw new AppError('這則廣播沒有附券', 'INVALID_STATE', 400);
  const scheduledAt = new Date(now);
  const queued = await tx.broadcast.updateMany({
    where: {
      id: broadcastId,
      tenantId,
      OR: [
        { status: { in: SENDABLE_STATUSES } },
        { status: 'sending', updatedAt: { lt: new Date(now - STALE_SENDING_MS) } },
      ],
    },
    data: { status: 'scheduled', scheduledAt, failureReason: null, failureCode: null },
  });
  if (queued.count === 0) {
    if (broadcast.status === 'sending') throw alreadySendingError();
    throw new AppError('此群發目前的狀態無法發送', 'INVALID_STATUS', 400);
  }
  const job: CouponBroadcastJobData = { tenantId, broadcastId };
  await ctx.enqueue(COUPON_BROADCAST_QUEUE, 'run', job, COUPON_BROADCAST_JOB_OPTIONS);
  return { id: broadcastId, status: 'scheduled' as const, scheduledAt };
}

// ── 發送：開始 ────────────────────────────────────────────────────────────

export interface CouponBroadcastPlan {
  broadcast: {
    id: string;
    name: string;
    /**
     * 這次執行的代次：搶占時寫入 broadcasts.sentAt 的時間。重新排入後新的執行會寫入新的時間，
     * 舊的執行之後的保留、進度與結果都以它比對，不符就停止（PR #364 第三輪審查）
     */
    runStartedAt: Date;
    channelId: string;
    targetType: string;
    segmentId: string | null;
    targetConfig: unknown;
    materialId: string | null;
    createdById: string;
    couponIssuedVia: string;
    couponMessage: string | null;
    couponIssuedByName: string | null;
  };
  coupon: { id: string; name: string; status: string; claimTagId: string | null; claimTagTtlDays: number | null };
  channel: { id: string; channelType: string; credentialsEncrypted: string; settings: unknown };
  material: { id: string; contentType: string; body: Record<string, unknown>; variables: TemplateVariable[] } | null;
  /** 素材有 {{coupon.url}}：只送素材；沒有就接著送發券文字 */
  materialHasCouponUrl: boolean;
  /** 素材有聯絡人變數（{{contact.name}} 等），保留時一併讀取 */
  needsContactVars: boolean;
}

export type ClaimResult =
  | { ok: true; plan: CouponBroadcastPlan }
  /** 已被搶占、或不是待發送的附券廣播 */
  | { ok: false; reason: 'NOT_CLAIMED' }
  /** 已搶占，但設定有問題：呼叫端標失敗 */
  | { ok: false; reason: 'INVALID'; code: string; message: string };

/**
 * 以條件式更新搶占「已排程」且排程時間已到的附券廣播：立即執行的 job 與每分鐘的排程只有一個搶得到。
 * 排程時間還沒到的不搶（job 晚到時，廣播可能已改成未來的排程時間）
 */
export async function claimCouponBroadcast(ctx: TenantCtx, broadcastId: string, now: number = Date.now()): Promise<ClaimResult> {
  const { tx, tenantId } = ctx;
  const claimed = await tx.broadcast.updateMany({
    where: { id: broadcastId, tenantId, status: 'scheduled', scheduledAt: { lte: new Date(now) }, couponId: { not: null } },
    data: { status: 'sending', sentAt: new Date(now), failureReason: null, failureCode: null },
  });
  if (claimed.count === 0) return { ok: false, reason: 'NOT_CLAIMED' };

  const b = await tx.broadcast.findFirst({ where: { id: broadcastId, tenantId } });
  if (!b?.couponId) return { ok: false, reason: 'NOT_CLAIMED' };
  const invalid = (code: string, message: string): ClaimResult => ({ ok: false, reason: 'INVALID', code, message });

  const coupon = await tx.coupon.findFirst({
    where: { id: b.couponId, tenantId },
    select: { id: true, name: true, status: true, claimTagId: true, claimTagTtlDays: true },
  });
  if (!coupon || coupon.status !== 'ACTIVE') {
    return invalid('COUPON_NOT_ACTIVE', '附上的優惠券已暫停或結束，沒有發送。恢復發放後可以重新發送');
  }
  const channel = await tx.channel.findFirst({
    where: { id: b.channelId, tenantId, isActive: true },
    select: { id: true, channelType: true, credentialsEncrypted: true, settings: true },
  });
  if (!channel) return invalid('CHANNEL_NOT_FOUND', '找不到此渠道或渠道已停用，請至設定確認');

  let material: CouponBroadcastPlan['material'] = null;
  if (b.materialId) {
    const m = await tx.material.findFirst({ where: { id: b.materialId, tenantId } });
    if (!m) return invalid('MATERIAL_NOT_FOUND', '找不到廣播的素材，可能已被刪除');
    material = {
      id: m.id,
      contentType: m.contentType,
      body: m.body as Record<string, unknown>,
      variables: (m.variables || []) as unknown as TemplateVariable[],
    };
  }
  const keys = material ? extractVariables(material.body) : [];
  return {
    ok: true,
    plan: {
      broadcast: {
        id: b.id,
        name: b.name,
        runStartedAt: new Date(now),
        channelId: b.channelId,
        targetType: b.targetType,
        segmentId: b.segmentId,
        targetConfig: b.targetConfig,
        materialId: b.materialId,
        createdById: b.createdById,
        couponIssuedVia: b.couponIssuedVia ?? COUPON_ISSUED_VIA.BROADCAST,
        couponMessage: b.couponMessage,
        couponIssuedByName: b.couponIssuedByName,
      },
      coupon,
      channel,
      material,
      materialHasCouponUrl: keys.includes(COUPON_URL_VARIABLE),
      needsContactVars: keys.some((k) => k !== COUPON_URL_VARIABLE),
    },
  };
}

/** 標記失敗：原因寫進資料庫，後台看得到（排程發送沒有人看得到回應） */
/** 這次執行仍擁有廣播的條件：發送中，且代次相同 */
const ownedBy = (runStartedAt: Date | undefined) => (runStartedAt ? { status: 'sending', sentAt: runStartedAt } : {});

/** 標記失敗。runStartedAt 有值時只在這次執行仍擁有廣播時寫入（已被重新排入的舊執行不覆寫） */
export async function failCouponBroadcast(ctx: TenantCtx, broadcastId: string, code: string, reason: string, runStartedAt?: Date) {
  await ctx.tx.broadcast.updateMany({
    where: { id: broadcastId, tenantId: ctx.tenantId, ...ownedBy(runStartedAt) },
    data: { status: 'failed', failureCode: code, failureReason: reason.slice(0, FAILURE_REASON_MAX_LENGTH) },
  });
}

// ── 發送：名單 ────────────────────────────────────────────────────────────

export interface PendingRecipient {
  contactId: string;
  uid: string;
  channelIdentityId: string;
}

export interface PreparedRecipients {
  /** 這次要處理的收件人（依名單順序，不含已有收件紀錄的人） */
  pending: PendingRecipient[];
  /** 名單總人數（含沒有渠道身分、視窗外的人） */
  total: number;
}

/** 依 id 分批查詢：避免超過 Postgres 的參數個數上限 */
const QUERY_CHUNK = 5000;

/**
 * 解析名單、略過已處理的人，並為拿不到券的人寫下跳過紀錄：
 * 勾選的聯絡人沒有這個渠道的身分（NO_CHANNEL_IDENTITY）、有訊息視窗的渠道超過視窗（OUTSIDE_MESSAGING_WINDOW）。
 */
export async function prepareRecipients(
  ctx: TenantCtx,
  plan: CouponBroadcastPlan,
  windowHours: number | undefined,
): Promise<PreparedRecipients> {
  const { tx, tenantId } = ctx;
  const b = plan.broadcast;
  const matched = await resolveAudience(tx, { tenantId, ...b });

  // 一位聯絡人在同一個渠道只取一個身分；手動挑選依勾選的順序
  const seen = new Set<string>();
  let identities = matched.filter((i) => (seen.has(i.contactId) ? false : (seen.add(i.contactId), true)));
  const picked = (b.targetConfig as { contactIds?: string[] } | null)?.contactIds ?? [];
  let noIdentity: string[] = [];
  if (b.targetType === 'contacts') {
    const order = new Map(picked.map((id, idx) => [id, idx]));
    identities = [...identities].sort((x, y) => (order.get(x.contactId) ?? 0) - (order.get(y.contactId) ?? 0));
    const missing = [...new Set(picked)].filter((id) => !seen.has(id));
    for (let i = 0; i < missing.length; i += QUERY_CHUNK) {
      const rows = await tx.contact.findMany({
        where: { id: { in: missing.slice(i, i + QUERY_CHUNK) }, tenantId },
        select: { id: true },
      });
      noIdentity.push(...rows.map((r) => r.id));
    }
    const exists = new Set(noIdentity);
    noIdentity = missing.filter((id) => exists.has(id));
  }

  // 開始發送時還停在 pending 的收件紀錄，是上次發送中斷留下的（搶占保證同時只有一個發送）。
  // 不重送：可能已經送達，送兩次比漏送更糟（design D29 至多一次）；標為發送中斷，結果頁看得到原因。
  // 這些券仍在發送中，由 coupon.scheduler 作廢並歸還名額
  await tx.broadcastRecipient.updateMany({
    where: { broadcastId: b.id, deliveryStatus: 'pending', broadcast: { tenantId } },
    data: { deliveryStatus: 'failed', skipReason: 'INTERRUPTED' satisfies RecipientFailReason },
  });

  const handled = new Set<string>();
  for (let i = 0; ; i += QUERY_CHUNK) {
    const rows = await tx.broadcastRecipient.findMany({
      where: { broadcastId: b.id },
      select: { contactId: true },
      orderBy: { id: 'asc' },
      skip: i,
      take: QUERY_CHUNK,
    });
    for (const r of rows) handled.add(r.contactId);
    if (rows.length < QUERY_CHUNK) break;
  }

  const reachable = await filterByMessagingWindow(tx, tenantId, b.channelId, identities, windowHours);
  const reachableIds = new Set(reachable.map((r) => r.contactId));
  const skips: Array<{ contactId: string; reason: RecipientSkipReason }> = [
    ...noIdentity.map((contactId) => ({ contactId, reason: 'NO_CHANNEL_IDENTITY' as const })),
    ...identities
      .filter((i) => !reachableIds.has(i.contactId))
      .map((i) => ({ contactId: i.contactId, reason: 'OUTSIDE_MESSAGING_WINDOW' as const })),
  ].filter((s) => !handled.has(s.contactId));
  if (skips.length > 0) {
    await tx.broadcastRecipient.createMany({
      data: skips.map((s) => ({ broadcastId: b.id, contactId: s.contactId, deliveryStatus: 'skipped', skipReason: s.reason })),
      skipDuplicates: true,
    });
  }

  const total = identities.length + noIdentity.length;
  await tx.broadcast.updateMany({ where: { id: b.id, tenantId }, data: { totalCount: total } });
  return {
    pending: reachable
      .filter((r) => !handled.has(r.contactId))
      .map((r) => ({ contactId: r.contactId, uid: r.uid, channelIdentityId: r.id })),
    total,
  };
}

// ── 發送：每位收件人 ──────────────────────────────────────────────────────

export type Reservation =
  | { kind: 'reserved'; instanceId: string; vars: Record<string, string> }
  /** 每人上限、發行總量、序號用完：不送訊息，已記為跳過 */
  | { kind: 'skipped'; reason: IssueSkipReason }
  /** 已有收件紀錄（並行或重送）：不處理 */
  | { kind: 'already' }
  /** 券在發送途中被暫停或結束：停止整則廣播 */
  | { kind: 'coupon_unavailable' }
  /** 這次執行已被重新排入的新執行取代（或廣播已不在發送中）：停止，不寫入任何結果 */
  | { kind: 'superseded' };

/** 第 1 步：保留一張發送中的券，並寫下收件紀錄（pending） */
export async function reserveRecipient(
  ctx: TenantCtx,
  plan: CouponBroadcastPlan,
  recipient: PendingRecipient,
  now: number = Date.now(),
): Promise<Reservation> {
  const { tx, tenantId } = ctx;
  const b = plan.broadcast;
  // 先確認這次執行仍擁有廣播：舊的執行停滯被重新排入後若還在跑，不能再發券
  const owned = await tx.broadcast.count({ where: { id: b.id, tenantId, ...ownedBy(b.runStartedAt) } });
  if (owned === 0) return { kind: 'superseded' };
  const existing = await tx.broadcastRecipient.findFirst({
    where: { broadcastId: b.id, contactId: recipient.contactId },
    select: { id: true },
  });
  if (existing) return { kind: 'already' };

  let outcome;
  try {
    outcome = await issueCoupons(ctx, plan.coupon.id, {
      contactIds: [recipient.contactId],
      issuedVia: b.couponIssuedVia,
      issuedRefId: b.id,
      sourceName: b.name,
      issuedByName: b.couponIssuedByName ?? undefined,
      // 帶連結的訊息送達後才貼標，送不出時不必撤回
      skipClaimTag: true,
    });
  } catch (err) {
    if (err instanceof CouponValidationError) return { kind: 'coupon_unavailable' };
    throw err;
  }
  const instance = outcome.issued[0];
  if (!instance) {
    const reason = outcome.skipped[0]?.reason ?? 'CONTACT_NOT_FOUND';
    await tx.broadcastRecipient.create({
      data: { broadcastId: b.id, contactId: recipient.contactId, deliveryStatus: 'skipped', skipReason: reason, sentAt: nowDate(now) },
    });
    return { kind: 'skipped', reason };
  }
  await tx.couponInstance.updateMany({ where: { id: instance.id, tenantId }, data: { deliveryPendingAt: nowDate(now) } });
  await tx.broadcastRecipient.create({
    data: { broadcastId: b.id, contactId: recipient.contactId, deliveryStatus: 'pending', couponInstanceId: instance.id, sentAt: nowDate(now) },
  });
  const vars = plan.needsContactVars ? await resolveContext(tx, { contactId: recipient.contactId, tenantId }) : {};
  return { kind: 'reserved', instanceId: instance.id, vars };
}

/** 第 3 步（帶連結的訊息送達）：確認這張券、貼領券標籤、收件紀錄標為已送出 */
export async function confirmRecipient(
  ctx: TenantCtx,
  plan: CouponBroadcastPlan,
  recipient: PendingRecipient,
  instanceId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const { tx, tenantId } = ctx;
  const confirmed = await confirmPendingInstance(tx, {
    tenantId,
    instanceId,
    contactId: recipient.contactId,
    coupon: plan.coupon,
    now,
  });
  if (!confirmed.confirmed) {
    await markRecipient(ctx, plan.broadcast.id, recipient.contactId, 'failed', 'CONFIRM_TOO_LATE', true);
    return false;
  }
  if (confirmed.tag) {
    await ctx.publish('contact.tagged', {
      contactId: recipient.contactId,
      tagId: confirmed.tag.tagId,
      tagName: confirmed.tag.tagName,
      source: 'system',
    });
  }
  await tx.broadcastRecipient.updateMany({
    where: { broadcastId: plan.broadcast.id, contactId: recipient.contactId },
    data: { deliveryStatus: 'sent', skipReason: null, sentAt: nowDate(now) },
  });
  return true;
}

/** 第 3 步（送不出）：作廢這張券、歸還名額，收件紀錄標為失敗並記原因 */
export async function voidRecipient(
  ctx: TenantCtx,
  broadcastId: string,
  contactId: string,
  instanceId: string,
  reason: RecipientFailReason,
): Promise<void> {
  await voidPendingInstance(ctx.tx, ctx.tenantId, instanceId);
  await markRecipient(ctx, broadcastId, contactId, 'failed', reason, true);
}

/** 只改收件紀錄（例如訊息已送出但確認失敗）；clearInstance 為 true 時清掉已作廢的券 */
export async function markRecipient(
  ctx: TenantCtx,
  broadcastId: string,
  contactId: string,
  deliveryStatus: 'failed' | 'skipped',
  reason: string,
  clearInstance = false,
): Promise<void> {
  await ctx.tx.broadcastRecipient.updateMany({
    where: { broadcastId, contactId },
    data: { deliveryStatus, skipReason: reason, ...(clearInstance ? { couponInstanceId: null } : {}) },
  });
}

// ── 發送：進度與結果 ──────────────────────────────────────────────────────

export interface CouponBroadcastSummary {
  /** 帶連結的訊息已送達、券已確認 */
  issued: number;
  /** 保留後還沒有結果（發送中，或程式中途結束） */
  pending: number;
  /** 依原因分列的跳過人數 */
  skipped: Record<string, number>;
  /** 依原因分列的失敗人數 */
  failed: Record<string, number>;
}

/** 依收件紀錄統計（重送時累計，不重算已處理的人） */
export async function getCouponBroadcastSummary(ctx: TenantCtx, broadcastId: string): Promise<CouponBroadcastSummary> {
  const rows = await ctx.tx.broadcastRecipient.groupBy({
    by: ['deliveryStatus', 'skipReason'],
    where: { broadcastId, broadcast: { tenantId: ctx.tenantId } },
    _count: { _all: true },
  });
  const summary: CouponBroadcastSummary = { issued: 0, pending: 0, skipped: {}, failed: {} };
  for (const r of rows) {
    const n = r._count._all;
    if (r.deliveryStatus === 'sent') summary.issued += n;
    else if (r.deliveryStatus === 'pending') summary.pending += n;
    else {
      const bucket = r.deliveryStatus === 'skipped' ? summary.skipped : summary.failed;
      const key = r.skipReason ?? 'UNKNOWN';
      bucket[key] = (bucket[key] ?? 0) + n;
    }
  }
  return summary;
}

const sumOf = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/**
 * 更新進度數字（發送中每處理一批呼叫一次；updatedAt 前進表示仍在發送）。
 * runStartedAt 有值時只在這次執行仍擁有廣播時寫入
 */
export async function recordProgress(ctx: TenantCtx, broadcastId: string, runStartedAt?: Date): Promise<CouponBroadcastSummary> {
  const s = await getCouponBroadcastSummary(ctx, broadcastId);
  await ctx.tx.broadcast.updateMany({
    where: { id: broadcastId, tenantId: ctx.tenantId, ...ownedBy(runStartedAt) },
    data: {
      successCount: s.issued,
      couponIssuedCount: s.issued,
      failedCount: sumOf(s.failed) + s.pending,
      skippedCount: sumOf(s.skipped),
    },
  });
  return s;
}

/**
 * 結束：依收件紀錄寫入結果。stopped 為中途停止的原因（例如券被暫停）；全部失敗時標失敗並寫下第一個渠道錯誤。
 */
export async function finalizeCouponBroadcast(
  ctx: TenantCtx,
  plan: CouponBroadcastPlan,
  opts: { stopped?: { code: string; reason: string }; firstError?: string | null; now?: number } = {},
): Promise<{ status: 'completed' | 'failed' | 'superseded'; summary: CouponBroadcastSummary }> {
  const { tx, tenantId } = ctx;
  const s = await recordProgress(ctx, plan.broadcast.id, plan.broadcast.runStartedAt);
  const failed = sumOf(s.failed) + s.pending;
  let status: 'completed' | 'failed' = 'completed';
  let failureCode: string | null = null;
  let failureReason: string | null = null;
  if (opts.stopped) {
    status = 'failed';
    failureCode = opts.stopped.code;
    failureReason = opts.stopped.reason;
  } else if (s.issued === 0 && failed > 0) {
    status = 'failed';
    failureCode = 'ALL_RECIPIENTS_FAILED';
    failureReason = allRecipientsFailedReason(failed, opts.firstError ?? null);
  }
  const written = await tx.broadcast.updateMany({
    where: { id: plan.broadcast.id, tenantId, ...ownedBy(plan.broadcast.runStartedAt) },
    data: {
      status,
      failureCode,
      failureReason: failureReason?.slice(0, FAILURE_REASON_MAX_LENGTH) ?? null,
      completedAt: status === 'completed' ? nowDate(opts.now) : null,
    },
  });
  // 已被新的執行取代：結果由新的執行寫入
  if (written.count === 0) return { status: 'superseded', summary: s };
  if (plan.material && s.issued > 0) {
    await tx.material.updateMany({
      where: { id: plan.material.id, tenantId },
      data: { usageCount: { increment: 1 }, lastUsedAt: nowDate(opts.now) },
    });
  }
  return { status, summary: s };
}

// ── 結果頁 ────────────────────────────────────────────────────────────────

export interface BroadcastRecipientView {
  contactId: string;
  displayName: string | null;
  deliveryStatus: string;
  reason: string | null;
  sentAt: Date;
}

/** 結果頁列出跳過或失敗的收件人（附原因），每頁 50 人 */
export async function listBroadcastRecipients(
  ctx: TenantCtx,
  broadcastId: string,
  filter: { status?: 'sent' | 'failed' | 'skipped' | 'pending'; page?: number; limit?: number } = {},
): Promise<{ items: BroadcastRecipientView[]; total: number; page: number; limit: number } | null> {
  const { tx, tenantId } = ctx;
  const page = Math.max(1, filter.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
  const broadcast = await tx.broadcast.findFirst({ where: { id: broadcastId, tenantId }, select: { id: true } });
  if (!broadcast) return null;
  const where: Prisma.BroadcastRecipientWhereInput = {
    broadcastId,
    ...(filter.status ? { deliveryStatus: filter.status } : {}),
  };
  const [rows, total] = await Promise.all([
    tx.broadcastRecipient.findMany({ where, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    tx.broadcastRecipient.count({ where }),
  ]);
  const contacts = rows.length
    ? await tx.contact.findMany({ where: { id: { in: rows.map((r) => r.contactId) }, tenantId }, select: { id: true, displayName: true } })
    : [];
  const names = new Map(contacts.map((c) => [c.id, c.displayName]));
  return {
    items: rows.map((r) => ({
      contactId: r.contactId,
      displayName: names.get(r.contactId) ?? null,
      deliveryStatus: r.deliveryStatus,
      reason: r.skipReason,
      sentAt: r.sentAt,
    })),
    total,
    page,
    limit,
  };
}

// ── 券詳情頁「發送給…」 ───────────────────────────────────────────────────

export interface BatchIssueInput {
  channelId: string;
  targetType: 'segment' | 'tags' | 'contacts';
  segmentId?: string;
  tagIds?: string[];
  contactIds?: string[];
  /** 選填的訊息文字；連結附在文字後。沒填用預設發券文字 */
  message?: string;
}

/** 批次發放的名稱（也是券的來源名稱）：批次發放 {YYYY-MM-DD HH:mm}（台灣時間，design D31） */
export function batchIssueName(at: Date): string {
  const hhmm = new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16);
  return `批次發放 ${taipeiDateString(at)} ${hhmm}`;
}

/**
 * 從券詳情頁批次發券：建立一則附券廣播（發放方式 batch、發放者為操作的使用者）並排入發送。
 * 行銷與客服補償券都可以；名單超過 1,000 人回 400，不建立廣播。
 */
export async function createBatchIssue(
  ctx: TenantCtx,
  agentId: string,
  couponId: string,
  input: BatchIssueInput,
  now: number = Date.now(),
) {
  const { tx, tenantId } = ctx;
  const agent = await tx.agent.findFirst({ where: { id: agentId, tenantId }, select: { name: true } });
  const contactIds = [...new Set(input.contactIds ?? [])];
  const targetConfig = input.targetType === 'tags' ? { tagIds: input.tagIds ?? [] } : input.targetType === 'contacts' ? { contactIds } : {};

  // 勾選的聯絡人去重後檢查上限：路由已驗證，service 也擋，其他入口呼叫時才不會繞過（PR #364 審查）
  if (input.targetType === 'contacts' && contactIds.length > BATCH_ISSUE_MAX_RECIPIENTS) {
    const message = `單次最多發給 ${BATCH_ISSUE_MAX_RECIPIENTS} 人，請縮小對象範圍`;
    throw new AppError(message, 'BATCH_TOO_LARGE', 400, { issues: [{ path: 'contactIds', message }] });
  }

  // 標籤與分眾的人數發送前才知道：先算一次，超過上限就不建立
  if (input.targetType !== 'contacts') {
    const matched = await resolveAudience(tx, {
      tenantId,
      channelId: input.channelId,
      targetType: input.targetType,
      segmentId: input.segmentId ?? null,
      targetConfig,
    });
    if (new Set(matched.map((m) => m.contactId)).size > BATCH_ISSUE_MAX_RECIPIENTS) {
      const message = `單次最多發給 ${BATCH_ISSUE_MAX_RECIPIENTS} 人，請縮小對象範圍`;
      throw new AppError(message, 'BATCH_TOO_LARGE', 400, { issues: [{ path: 'targetType', message }] });
    }
  }

  const broadcast = await createBroadcast(tx, tenantId, agentId, {
    name: batchIssueName(new Date(now)),
    channelId: input.channelId,
    targetType: input.targetType,
    segmentId: input.segmentId,
    targetConfig,
    couponId,
    couponIssuedVia: COUPON_ISSUED_VIA.BATCH,
    couponMessage: input.message,
    couponIssuedByName: agent?.name ?? undefined,
  });
  const queued = await queueCouponBroadcast(ctx, broadcast.id, now);
  return { broadcastId: broadcast.id, name: broadcast.name, status: queued.status };
}

/** 券詳情頁：這張券的附券廣播與批次發放（新到舊，最多 20 則），附結果統計 */
export async function listCouponBroadcasts(ctx: TenantCtx, couponId: string) {
  const { tx, tenantId } = ctx;
  const rows = await tx.broadcast.findMany({
    where: { tenantId, couponId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, name: true, status: true, couponIssuedVia: true, couponIssuedByName: true, totalCount: true,
      couponIssuedCount: true, failureReason: true, failureCode: true, createdAt: true, scheduledAt: true, sentAt: true,
    },
  });
  const items = [];
  for (const r of rows) items.push({ ...r, summary: await getCouponBroadcastSummary(ctx, r.id) });
  return items;
}
