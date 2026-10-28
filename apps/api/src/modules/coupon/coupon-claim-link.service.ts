/**
 * 公開領券連結（add-coupon-system A15 15.29、15.30；design D30）。
 *
 * - 後台：建立、列出、改名與期間、停用與重新啟用。只有行銷券能建立（補償券不應公開散布）。
 * - 公開頁：以代碼讀出券與渠道按鈕，累計開啟數。代碼全系統唯一；以代碼找租戶的那一步在
 *   findClaimLinkTenant（SECURITY DEFINER 函式，只回租戶 id），之後一律在綁定租戶的交易內。
 * - 入站：顧客傳送含代碼的訊息後，保留券（發送中）→ 交易外送出 → 確認或作廢（design D16、D25），
 *   失敗也回覆顧客並在對話留下紀錄。三個步驟的串接在 coupon-claim.flow.ts。
 *
 * service 只收 TenantCtx（AGENTS.md 結構規則 2）；交易由入口開。不在交易內呼叫渠道或 Redis。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { confirmPendingInstance, logger } from '@open333crm/core';
import { COUPON_ISSUED_VIA } from '@open333crm/shared';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { issueCoupons } from './coupon-issue.service.js';
import { CouponValidationError } from './coupon.service.js';
import {
  CLAIM_CHANNEL_TYPES,
  CLAIM_FAILURE_NOTE,
  CLAIM_REPLY_TEXT,
  buildClaimChannelLink,
  claimChannelLabel,
  claimPageUrl,
  generateClaimCode,
  normalizeClaimCode,
  type ClaimChannelLink,
  type ClaimFailureReason,
} from './coupon-claim-code.js';

// ── 後台 ───────────────────────────────────────────────────────────────────

export interface ClaimLinkInput {
  name: string;
  channelId: string;
  startAt?: Date | null;
  endAt?: Date | null;
}

const LINK_SELECT = {
  id: true, couponId: true, name: true, code: true, status: true, startAt: true, endAt: true,
  openCount: true, claimCount: true, createdAt: true,
  channel: { select: { id: true, channelType: true, displayName: true, settings: true, isActive: true } },
} as const;

type LinkRow = Prisma.CouponClaimLinkGetPayload<{ select: typeof LINK_SELECT }>;

export interface ClaimLinkView {
  id: string;
  couponId: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'DISABLED';
  startAt: Date | null;
  endAt: Date | null;
  openCount: number;
  claimCount: number;
  createdAt: Date;
  url: string;
  channel: {
    id: string;
    channelType: string;
    displayName: string;
    /** 渠道沒有公開帳號 ID（或已停用）時顧客開不了對話，後台要提示 */
    ready: boolean;
  };
}

function toView(row: LinkRow, webBaseUrl: string): ClaimLinkView {
  return {
    id: row.id,
    couponId: row.couponId,
    name: row.name,
    code: row.code,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    openCount: row.openCount,
    claimCount: row.claimCount,
    createdAt: row.createdAt,
    url: claimPageUrl(webBaseUrl, row.code),
    channel: {
      id: row.channel.id,
      channelType: row.channel.channelType,
      displayName: row.channel.displayName,
      ready: row.channel.isActive && buildClaimChannelLink(row.channel.channelType, row.channel.settings, row.code) !== null,
    },
  };
}

/** 券不存在回 null */
export async function listClaimLinks(ctx: TenantCtx, couponId: string, webBaseUrl: string): Promise<ClaimLinkView[] | null> {
  const { tx, tenantId } = ctx;
  const coupon = await tx.coupon.findFirst({ where: { id: couponId, tenantId }, select: { id: true } });
  if (!coupon) return null;
  const rows = await tx.couponClaimLink.findMany({
    where: { tenantId, couponId },
    orderBy: { createdAt: 'desc' },
    select: LINK_SELECT,
  });
  return rows.map((r) => toView(r, webBaseUrl));
}

export interface AvailableClaimLinkView extends ClaimLinkView {
  couponName: string;
}

/** 素材編輯器「插入領券連結」一次最多列出的筆數 */
const AVAILABLE_LINKS_LIMIT = 200;

/**
 * 租戶內現在可以放進訊息的領券連結：連結啟用、券進行中、連結沒有結束（尚未開始的可以先放）。
 * 素材編輯器的「插入領券連結」用（change improve-coupon-url-insert-ux design D6）。
 */
export async function listAvailableClaimLinks(
  ctx: TenantCtx,
  webBaseUrl: string,
  /** channelType：只列這個渠道類型（LINE、FB、THREADS）的連結；素材編輯器帶入素材的渠道 */
  filter: { channelType?: string } = {},
  now: Date = new Date(),
): Promise<AvailableClaimLinkView[]> {
  const { tx, tenantId } = ctx;
  const rows = await tx.couponClaimLink.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      coupon: { status: 'ACTIVE' },
      ...(filter.channelType ? { channel: { channelType: filter.channelType as never } } : {}),
      OR: [{ endAt: null }, { endAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
    take: AVAILABLE_LINKS_LIMIT,
    select: { ...LINK_SELECT, coupon: { select: { name: true } } },
  });
  return rows.map((r) => ({ ...toView(r, webBaseUrl), couponName: r.coupon.name }));
}

export async function getClaimLink(ctx: TenantCtx, couponId: string, linkId: string, webBaseUrl: string): Promise<ClaimLinkView | null> {
  const row = await ctx.tx.couponClaimLink.findFirst({
    where: { id: linkId, couponId, tenantId: ctx.tenantId },
    select: LINK_SELECT,
  });
  return row ? toView(row, webBaseUrl) : null;
}

function assertPeriod(startAt: Date | null | undefined, endAt: Date | null | undefined) {
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    throw new CouponValidationError('結束時間須晚於開始時間');
  }
}

/** 代碼撞到既有代碼（全系統唯一）時重試；在 savepoint 內建立，撞到時只回滾這一段 */
const MAX_CODE_ATTEMPTS = 5;

/**
 * 建立領券連結。券不存在回 null；補償券、已暫停或結束的券、其他租戶或不支援的渠道丟 CouponValidationError（400）。
 */
export async function createClaimLink(
  ctx: TenantCtx,
  couponId: string,
  createdById: string,
  input: ClaimLinkInput,
  webBaseUrl: string,
): Promise<ClaimLinkView | null> {
  const { tx, tenantId } = ctx;
  const coupon = await tx.coupon.findFirst({ where: { id: couponId, tenantId }, select: { purpose: true, status: true } });
  if (!coupon) return null;
  if (coupon.purpose !== 'MARKETING') throw new CouponValidationError('只有行銷券能建立領券連結，客服補償券不能公開領取');
  if (coupon.status !== 'ACTIVE' && coupon.status !== 'DRAFT') {
    throw new CouponValidationError('只有草稿或進行中的券能建立領券連結');
  }
  // 以 tenantId 為條件：其他租戶的渠道在 RLS 下也查不到，兩層都擋
  const channel = await tx.channel.findFirst({
    where: { id: input.channelId, tenantId, isActive: true },
    select: { id: true, channelType: true },
  });
  if (!channel) throw new CouponValidationError('找不到這個渠道，請重新選擇');
  if (!CLAIM_CHANNEL_TYPES.includes(channel.channelType as never)) {
    throw new CouponValidationError('領券連結只支援 LINE、Facebook 與 Instagram 渠道');
  }
  assertPeriod(input.startAt, input.endAt);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    await tx.$executeRawUnsafe('SAVEPOINT coupon_claim_link_code');
    try {
      const row = await tx.couponClaimLink.create({
        data: {
          tenantId,
          couponId,
          channelId: channel.id,
          name: input.name,
          code: generateClaimCode(),
          startAt: input.startAt ?? null,
          endAt: input.endAt ?? null,
          createdById,
        },
        select: LINK_SELECT,
      });
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT coupon_claim_link_code');
      return toView(row, webBaseUrl);
    } catch (err) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT coupon_claim_link_code');
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }
  throw new Error('領券連結代碼產生失敗（連續撞到既有代碼）');
}

export async function updateClaimLink(
  ctx: TenantCtx,
  couponId: string,
  linkId: string,
  input: { name?: string; startAt?: Date | null; endAt?: Date | null },
  webBaseUrl: string,
): Promise<ClaimLinkView | null> {
  const { tx, tenantId } = ctx;
  const current = await tx.couponClaimLink.findFirst({
    where: { id: linkId, couponId, tenantId },
    select: { startAt: true, endAt: true },
  });
  if (!current) return null;
  const startAt = input.startAt === undefined ? current.startAt : input.startAt;
  const endAt = input.endAt === undefined ? current.endAt : input.endAt;
  assertPeriod(startAt, endAt);
  await tx.couponClaimLink.updateMany({
    where: { id: linkId, tenantId },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), startAt, endAt },
  });
  return getClaimLink(ctx, couponId, linkId, webBaseUrl);
}

export async function setClaimLinkStatus(
  ctx: TenantCtx,
  couponId: string,
  linkId: string,
  status: 'ACTIVE' | 'DISABLED',
  webBaseUrl: string,
): Promise<ClaimLinkView | null> {
  const updated = await ctx.tx.couponClaimLink.updateMany({
    where: { id: linkId, couponId, tenantId: ctx.tenantId },
    data: { status },
  });
  if (updated.count === 0) return null;
  return getClaimLink(ctx, couponId, linkId, webBaseUrl);
}

// ── 公開頁 ─────────────────────────────────────────────────────────────────

/**
 * 以代碼找出所屬租戶（公開頁沒有登入、沒有租戶）。呼叫 migration 建立的 SECURITY DEFINER 函式，
 * 只拿到租戶 id；格式不對、不存在或租戶停用時回 null。prisma 是未綁定租戶的 app_tenant 連線。
 */
export async function findClaimLinkTenant(prisma: PrismaClient, rawCode: string): Promise<{ tenantId: string; code: string } | null> {
  const code = normalizeClaimCode(rawCode);
  if (!code) return null;
  const rows = await prisma.$queryRaw<Array<{ tenantId: string | null }>>`SELECT coupon_claim_link_tenant(${code}) AS "tenantId"`;
  const tenantId = rows[0]?.tenantId;
  return tenantId ? { tenantId, code } : null;
}

interface LinkAvailability {
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  coupon: { status: string };
}

/** 連結啟用、在期間內、券進行中才能領 */
export function isClaimable(link: LinkAvailability, now: Date): boolean {
  if (link.status !== 'ACTIVE' || link.coupon.status !== 'ACTIVE') return false;
  if (link.startAt && link.startAt.getTime() > now.getTime()) return false;
  if (link.endAt && link.endAt.getTime() <= now.getTime()) return false;
  return true;
}

export interface PublicClaimPage {
  available: boolean;
  /** 不能領時的說明 */
  message: string | null;
  coupon: {
    name: string;
    description: string | null;
    imageUrl: string | null;
    couponType: string | null;
    discountAmount: number | null;
    discountPercent: number | null;
    percentCap: number | null;
    minSpend: number | null;
    giftName: string | null;
    giftQty: number | null;
    exchangeItem: string | null;
    validityMode: string | null;
    startAt: Date | null;
    endAt: Date | null;
    afterClaimDays: number | null;
    afterOpenMinutes: number | null;
  };
  /** 領券按鈕；不能領時為 null */
  channel: ClaimChannelLink | null;
}

/** 公開頁資料，並累計開啟數。查無連結回 null（呼叫端回 404）。 */
export async function openPublicClaimPage(ctx: TenantCtx, code: string, now: Date = new Date()): Promise<PublicClaimPage | null> {
  const { tx, tenantId } = ctx;
  const link = await tx.couponClaimLink.findFirst({
    where: { code, tenantId },
    select: {
      id: true, status: true, startAt: true, endAt: true, code: true,
      channel: { select: { channelType: true, settings: true, isActive: true } },
      coupon: {
        select: {
          status: true, name: true, description: true, imageUrl: true, couponType: true, discountAmount: true,
          discountPercent: true, percentCap: true, minSpend: true, giftName: true, giftQty: true, exchangeItem: true,
          validityMode: true, startAt: true, endAt: true, afterClaimDays: true, afterOpenMinutes: true,
        },
      },
    },
  });
  if (!link) return null;
  await tx.couponClaimLink.updateMany({ where: { id: link.id, tenantId }, data: { openCount: { increment: 1 } } });

  const channel = link.channel.isActive ? buildClaimChannelLink(link.channel.channelType, link.channel.settings, link.code) : null;
  const available = isClaimable(link, now) && channel !== null;
  const { status: _status, ...coupon } = link.coupon;
  return {
    available,
    message: available ? null : CLAIM_REPLY_TEXT.unavailable,
    coupon,
    channel: available ? channel : null,
  };
}

// ── 入站：顧客傳送領券代碼 ─────────────────────────────────────────────────

export interface InboundClaimLink {
  id: string;
  name: string;
  code: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  couponId: string;
  channelId: string;
  channel: { channelType: string; settings: Prisma.JsonValue };
  coupon: {
    status: string;
    name: string;
    couponType: string | null;
    discountAmount: number | null;
    discountPercent: number | null;
    giftName: string | null;
    exchangeItem: string | null;
    minSpend: number | null;
    claimTagId: string | null;
    claimTagTtlDays: number | null;
  };
}

/**
 * 本租戶中符合候選代碼的領券連結（依候選順序取第一個）；其他租戶的代碼查不到。
 * 收入站管線的 client（webhook 以渠道反查租戶，見 webhook.service），條件一律帶 tenantId；
 * 大部分訊息查不到代碼，不為了這一個查詢開交易。
 */
export async function findInboundClaimLink(
  db: Pick<Prisma.TransactionClient, 'couponClaimLink'>,
  tenantId: string,
  candidates: string[],
): Promise<InboundClaimLink | null> {
  if (candidates.length === 0) return null;
  const rows = await db.couponClaimLink.findMany({
    where: { tenantId, code: { in: candidates } },
    select: {
      id: true, name: true, code: true, status: true, startAt: true, endAt: true, couponId: true, channelId: true,
      channel: { select: { channelType: true, settings: true } },
      coupon: {
        select: {
          status: true, name: true, couponType: true, discountAmount: true, discountPercent: true,
          giftName: true, exchangeItem: true, minSpend: true, claimTagId: true, claimTagTtlDays: true,
        },
      },
    },
  });
  for (const code of candidates) {
    const hit = rows.find((r) => r.code === code);
    if (hit) return hit;
  }
  return null;
}

export interface ClaimActor {
  /** 收到訊息的渠道 */
  channelId: string;
  contactId: string;
  conversationId: string;
}

export interface ReservedClaim {
  instanceId: string;
  expiresAt: Date | null;
}

export type ReserveClaimResult =
  | { ok: true; reserved: ReservedClaim }
  | { ok: false; reason: ClaimFailureReason; replyText: string };

const SOLD_OUT_SKIPS = new Set(['TOTAL_LIMIT_REACHED', 'CODES_EXHAUSTED']);

/**
 * 第 1 步：檢查並建立發送中的券（issuedVia='public_link'、issuedRefId=連結 id、來源名稱=連結名稱）。
 * 不能發時回傳原因與要回覆顧客的文字，交易照常提交（沒有寫入）。
 */
export async function reserveClaim(
  ctx: TenantCtx,
  link: InboundClaimLink,
  actor: ClaimActor,
  now: Date = new Date(),
): Promise<ReserveClaimResult> {
  if (link.channelId !== actor.channelId) {
    return {
      ok: false,
      reason: 'WRONG_CHANNEL',
      replyText: CLAIM_REPLY_TEXT.wrongChannel(claimChannelLabel(link.channel.channelType, link.channel.settings)),
    };
  }
  if (!isClaimable(link, now)) return { ok: false, reason: 'LINK_UNAVAILABLE', replyText: CLAIM_REPLY_TEXT.unavailable };

  let outcome;
  try {
    outcome = await issueCoupons(ctx, link.couponId, {
      contactIds: [actor.contactId],
      issuedVia: COUPON_ISSUED_VIA.PUBLIC_LINK,
      issuedRefId: link.id,
      sourceName: link.name,
      // 送出成功後才貼標，送不出時不必撤回標籤
      skipClaimTag: true,
    });
  } catch (err) {
    // 讀到進行中之後、鎖住之前被暫停或結束
    if (err instanceof CouponValidationError) return { ok: false, reason: 'LINK_UNAVAILABLE', replyText: CLAIM_REPLY_TEXT.unavailable };
    throw err;
  }
  const instance = outcome.issued[0];
  if (!instance) {
    const reason = outcome.skipped[0]?.reason;
    if (reason === 'PER_CONTACT_LIMIT_REACHED') return { ok: false, reason: 'ALREADY_CLAIMED', replyText: CLAIM_REPLY_TEXT.alreadyClaimed };
    if (reason && SOLD_OUT_SKIPS.has(reason)) return { ok: false, reason: 'SOLD_OUT', replyText: CLAIM_REPLY_TEXT.soldOut };
    logger.warn('[CouponClaim] 發券未成功', { tenantId: ctx.tenantId, linkId: link.id, reason });
    return { ok: false, reason: 'ISSUE_FAILED', replyText: CLAIM_REPLY_TEXT.failed };
  }
  const created = await ctx.tx.couponInstance.update({
    where: { id: instance.id, tenantId: ctx.tenantId },
    data: { deliveryPendingAt: now },
    select: { expiresAt: true },
  });
  return { ok: true, reserved: { instanceId: instance.id, expiresAt: created.expiresAt } };
}

/**
 * 第 3 步（訊息送出成功後）：清除發送中、貼標、累計領取數、寫入券卡訊息。
 * 回傳寫入的訊息與這次貼上的標籤，推播與 contact.tagged 由 flow 決定。
 * 券在確認前已被排程作廢時回 null。
 */
export async function confirmClaim(
  ctx: TenantCtx,
  link: InboundClaimLink,
  actor: ClaimActor,
  reserved: ReservedClaim,
  text: string,
  now: Date = new Date(),
) {
  const { tx, tenantId } = ctx;
  const confirmed = await confirmPendingInstance(tx, {
    tenantId,
    instanceId: reserved.instanceId,
    contactId: actor.contactId,
    coupon: link.coupon,
    // 標籤到期時間以流程的時間計算（PR #364 審查）
    now: now.getTime(),
  });
  if (!confirmed.confirmed) return null;
  await tx.couponClaimLink.updateMany({ where: { id: link.id, tenantId }, data: { claimCount: { increment: 1 } } });
  const message = await writeClaimMessage(ctx, actor.conversationId, {
    text,
    coupon: {
      instanceId: reserved.instanceId,
      couponId: link.couponId,
      name: link.coupon.name,
      couponType: link.coupon.couponType,
      discountAmount: link.coupon.discountAmount,
      discountPercent: link.coupon.discountPercent,
      giftName: link.coupon.giftName,
      exchangeItem: link.coupon.exchangeItem,
      minSpend: link.coupon.minSpend,
      expiresAt: reserved.expiresAt?.toISOString() ?? null,
      // 收件匣券卡寫「由 … 發送」
      issuedByName: `領券連結「${link.name}」`,
    },
  }, { source: 'coupon_claim_link', claimLinkId: link.id, claimLinkName: link.name }, now);
  return { message, tag: confirmed.tag };
}

/**
 * 沒有發出券時的紀錄：回覆顧客的文字（送不出時標紅色）與原因，讓客服在對話看得到。
 * 回傳寫入的訊息，推播由 flow 決定。
 */
export async function recordClaimReply(
  ctx: TenantCtx,
  link: Pick<InboundClaimLink, 'id' | 'name'>,
  conversationId: string,
  params: { text: string; reason: ClaimFailureReason; delivered: boolean },
  now: Date = new Date(),
) {
  return writeClaimMessage(ctx, conversationId, { text: params.text }, {
    source: 'coupon_claim_link',
    claimLinkId: link.id,
    claimLinkName: link.name,
    couponClaimFailed: { reason: params.reason, note: CLAIM_FAILURE_NOTE[params.reason] },
    ...(params.delivered ? {} : { deliveryFailed: true, deliveryError: '回覆顧客的訊息沒有送出' }),
  }, now);
}

async function writeClaimMessage(
  ctx: TenantCtx,
  conversationId: string,
  content: Record<string, unknown>,
  metadata: Record<string, unknown>,
  now: Date,
) {
  const { tx, tenantId } = ctx;
  const sequence = (await tx.message.count({ where: { conversationId } })) + 1;
  const message = await tx.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'text',
      content: content as Prisma.InputJsonValue,
      metadata: metadata as Prisma.InputJsonValue,
      sequence,
      isRead: true,
      createdAt: now,
    },
  });
  await tx.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { lastMessageAt: now } });
  return message;
}
