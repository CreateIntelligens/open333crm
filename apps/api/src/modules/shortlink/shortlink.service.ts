/**
 * Short link service — CRUD, click tracking, stats.
 *
 * 收 TenantCtx 的函式由 shortlink.flow.ts 開交易（#337 階段 3，AGENTS.md 結構規則 2）。
 * 本檔不抓 OG、不推播、不發事件：OG 快照見 og-snapshot.ts，其餘由 flow 在 commit 前後處理。
 * 公開的轉址路由沒有租戶，getLinkForRedirect、getChannelLiffId 收 prismaAdmin。
 */

import type { PrismaClient, ShortLink } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { logger } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import type { OgSnapshot } from './og-scraper.js';
import { addTagToTarget, type ContactTagged } from '../tag/tagging.service.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateSlug(length = 6): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

/** Ensure a lineChannelId belongs to this tenant and is a LINE channel. */
async function assertLineChannel(ctx: TenantCtx, channelId: string): Promise<void> {
  const channel = await ctx.tx.channel.findFirst({
    where: { id: channelId, tenantId: ctx.tenantId, channelType: 'LINE' },
    select: { id: true },
  });
  if (!channel) throw new Error('lineChannelId 必須是本租戶的 LINE 渠道');
}

/** 沒有手動填任何 OG 欄位時，建立或修改目標網址之後要抓 OG 快照 */
export function needsOgSnapshot(provided: { ogTitle?: string; ogDescription?: string; ogImage?: string }): boolean {
  return !provided.ogTitle && !provided.ogDescription && !provided.ogImage;
}

/** 把抓到的 OG 快照寫回短連結；三個欄位都沒抓到時不寫 */
export async function saveShortLinkOg(ctx: TenantCtx, linkId: string, og: OgSnapshot): Promise<void> {
  if (!og.ogTitle && !og.ogDescription && !og.ogImage) return;
  await ctx.tx.shortLink.updateMany({
    where: { id: linkId, tenantId: ctx.tenantId },
    data: { ogTitle: og.ogTitle, ogDescription: og.ogDescription, ogImage: og.ogImage },
  });
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listShortLinks(
  ctx: TenantCtx,
  filters: { isActive?: string; q?: string; page?: number; limit?: number },
) {
  const { tx: prisma, tenantId } = ctx;
  const where: Record<string, unknown> = { tenantId };
  if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: 'insensitive' } },
      { slug: { contains: filters.q, mode: 'insensitive' } },
      { targetUrl: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const [items, total] = await Promise.all([
    prisma.shortLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shortLink.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function getShortLink(ctx: TenantCtx, id: string) {
  return ctx.tx.shortLink.findFirst({ where: { id, tenantId: ctx.tenantId } });
}

export interface CreateShortLinkInput {
  targetUrl: string;
  title?: string;
  slug?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  lineChannelId?: string | null;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  tagOnClick?: string;
  materialId?: string;
  // routes 用 z.coerce.date() 驗完直接給 Date，這裡不再收字串
  expiresAt?: Date;
}

/** 建立短連結。沒有手動填 OG 時，呼叫端在 commit 之後抓 OG 快照（og-snapshot.ts） */
export async function createShortLink(
  ctx: TenantCtx,
  createdById: string,
  data: CreateShortLinkInput,
): Promise<ShortLink> {
  const { tx: prisma, tenantId } = ctx;
  let slug = data.slug;
  if (!slug) {
    // Generate unique slug
    for (let i = 0; i < 10; i++) {
      slug = generateSlug();
      const existing = await prisma.shortLink.findUnique({ where: { slug } });
      if (!existing) break;
    }
  } else {
    // Check custom slug uniqueness
    const existing = await prisma.shortLink.findUnique({ where: { slug } });
    // 這句會原封不動顯示在建立視窗上（前端已改為顯示後端訊息），所以用中文。
    if (existing) throw new Error('這個自訂代碼已經被使用了，請換一個');
  }

  if (data.lineChannelId) {
    await assertLineChannel(ctx, data.lineChannelId);
  }

  return prisma.shortLink.create({
    data: {
      tenantId,
      createdById,
      slug: slug!,
      targetUrl: data.targetUrl,
      title: data.title,
      ogTitle: data.ogTitle,
      ogDescription: data.ogDescription,
      ogImage: data.ogImage,
      lineChannelId: data.lineChannelId || null,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmContent: data.utmContent,
      utmTerm: data.utmTerm,
      tagOnClick: data.tagOnClick,
      materialId: data.materialId ?? null,
      expiresAt: data.expiresAt,
    },
  });
}

/** 短連結對外網址（供發送時把素材 URL 換成可追蹤連結）。 */
export function shortLinkPublicUrl(slug: string): string {
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
  return `${baseUrl}/s/${slug}`;
}

/** 判斷 URL 是否已是本站短連結（避免二次包裝）。 */
export function isOwnShortLink(url: string): boolean {
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
  return url.startsWith(`${baseUrl}/s/`) || /\/s\/[A-Za-z0-9_-]+$/.test(url);
}

/**
 * 取得或建立「素材短連結」：同 (materialId, targetUrl) 已有就複用，無則建。
 * 用於廣播發送時把素材 body 的外部 URL 換成帶 materialId 的可追蹤短連結（素材層共用）。
 * 回傳短連結對外網址（URL 已是短連結時回原 URL），以及這次新建的短連結：
 * 呼叫端在 commit 之後為新建的短連結抓 OG 快照（og-snapshot.ts）。
 */
export async function findOrCreateMaterialShortLink(
  ctx: TenantCtx,
  createdById: string,
  params: { materialId: string; targetUrl: string; lineChannelId?: string | null; tagOnClick?: string | null },
): Promise<{ url: string; created: ShortLink | null }> {
  const { tx: prisma, tenantId } = ctx;
  const { materialId, targetUrl, lineChannelId, tagOnClick } = params;
  // 已是本站短連結 → 不二次包裝
  if (isOwnShortLink(targetUrl)) return { url: targetUrl, created: null };

  // 複用同素材同目標的既有短連結；tagOnClick 有指定則同步更新（同 uri 取本次設定的標籤）
  const existing = await prisma.shortLink.findFirst({
    where: { tenantId, materialId, targetUrl, isActive: true },
    select: { id: true, slug: true, tagOnClick: true },
  });
  if (existing) {
    if (tagOnClick !== undefined && existing.tagOnClick !== tagOnClick) {
      await prisma.shortLink.update({ where: { id: existing.id }, data: { tagOnClick: tagOnClick ?? null } });
    }
    return { url: shortLinkPublicUrl(existing.slug), created: null };
  }

  const link = await createShortLink(ctx, createdById, {
    targetUrl,
    materialId,
    lineChannelId: lineChannelId ?? null,
    tagOnClick: tagOnClick ?? undefined,
  });
  return { url: shortLinkPublicUrl(link.slug), created: link };
}

/** 修改短連結。改了目標網址、又沒有手動填 OG 時，呼叫端在 commit 之後重抓 OG 快照 */
export async function updateShortLink(
  ctx: TenantCtx,
  id: string,
  data: {
    targetUrl?: string;
    title?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    lineChannelId?: string | null;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    tagOnClick?: string;
    isActive?: boolean;
    // null = 清除到期時間；undefined = 這欄不動
    expiresAt?: Date | null;
  },
) {
  const { tx: prisma, tenantId } = ctx;
  const link = await prisma.shortLink.findFirst({ where: { id, tenantId } });
  if (!link) return null;

  // 選填文字欄位：undefined = 這欄不動；空字串 = 使用者清空了，存成 null
  const clearable = (v: string | undefined) => (v === undefined ? undefined : v === '' ? null : v);

  if (data.lineChannelId) {
    await assertLineChannel(ctx, data.lineChannelId);
  }

  return prisma.shortLink.update({
    where: { id },
    data: {
      targetUrl: data.targetUrl,
      title: clearable(data.title),
      ogTitle: clearable(data.ogTitle),
      ogDescription: clearable(data.ogDescription),
      ogImage: clearable(data.ogImage),
      lineChannelId: data.lineChannelId === undefined ? undefined : data.lineChannelId || null,
      utmSource: clearable(data.utmSource),
      utmMedium: clearable(data.utmMedium),
      utmCampaign: clearable(data.utmCampaign),
      utmContent: clearable(data.utmContent),
      utmTerm: clearable(data.utmTerm),
      tagOnClick: clearable(data.tagOnClick),
      isActive: data.isActive,
      expiresAt: data.expiresAt,
    },
  });
}

export async function deleteShortLink(ctx: TenantCtx, id: string) {
  const link = await ctx.tx.shortLink.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!link) return null;
  return ctx.tx.shortLink.delete({ where: { id } });
}

// ─── Redirect resolution (read-only — no tracking) ───────────────────────────

function buildTargetUrl(link: {
  targetUrl: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}): string {
  const url = new URL(link.targetUrl);
  if (link.utmSource) url.searchParams.set('utm_source', link.utmSource);
  if (link.utmMedium) url.searchParams.set('utm_medium', link.utmMedium);
  if (link.utmCampaign) url.searchParams.set('utm_campaign', link.utmCampaign);
  if (link.utmContent) url.searchParams.set('utm_content', link.utmContent);
  if (link.utmTerm) url.searchParams.set('utm_term', link.utmTerm);
  return url.toString();
}

const CONTACT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLive(link: { isActive: boolean; expiresAt: Date | null }): boolean {
  if (!link.isActive) return false;
  if (link.expiresAt && link.expiresAt < new Date()) return false;
  return true;
}

/**
 * Read-only resolution for the GET redirect handler. Returns the link record
 * and the resolved target URL (with UTM), or null if missing/inactive/expired.
 * Records NOTHING — the click is only counted later by `trackClick`.
 */
export async function getLinkForRedirect(prisma: PrismaClient, slug: string) {
  const link = await prisma.shortLink.findUnique({ where: { slug } });
  if (!link || !isLive(link)) return null;
  return { link, targetUrl: buildTargetUrl(link) };
}

/** Resolve the LIFF app id bound to a LINE channel (from its settings JSON). */
export async function getChannelLiffId(prisma: PrismaClient, channelId: string): Promise<string | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { settings: true },
  });
  const settings = (channel?.settings ?? {}) as { liffConfig?: { liffId?: string } };
  return settings.liffConfig?.liffId || null;
}

/** Resolve a contact from a lineUid via ChannelIdentity under the bound LINE channel. */
async function resolveContactByLineUid(ctx: TenantCtx, channelId: string, lineUid: string): Promise<string | null> {
  const identity = await ctx.tx.channelIdentity.findUnique({
    where: { channelId_uid: { channelId, uid: lineUid } },
    select: { contactId: true },
  });
  return identity?.contactId ?? null;
}

// ─── Click Tracking (the single authoritative count) ─────────────────────────

export interface ClickMeta {
  contactId?: string;
  lineUid?: string;
  ip?: string;
  userAgent?: string;
  referer?: string;
}

export interface RecordedClick {
  contactId: string | undefined;
  isUnique: boolean;
  totalClicks: number;
  uniqueClicks: number;
  /** 點擊貼標成功時，這次貼上的標籤；沒有設定點擊標籤、找不到聯絡人或貼標失敗時為 null */
  tagged: ContactTagged | null;
}

/**
 * Record one click. This is the ONLY place a click is counted — invoked by the
 * front-end beacon/fetch to `POST /s/track`, never by the GET redirect handler.
 * 在 trackClickFlow 開的交易內執行（租戶取自短連結）；推播與事件由 flow 送出。
 */
export async function recordClick(
  ctx: TenantCtx,
  link: Pick<ShortLink, 'id' | 'lineChannelId' | 'tagOnClick'>,
  meta: ClickMeta,
): Promise<RecordedClick> {
  const { tx: prisma, tenantId } = ctx;

  // Who actually clicked: the lineUid's contact wins; otherwise the cid from the URL.
  // cid 來自公開請求：必須是這個短連結所屬租戶的聯絡人才採用，
  // 否則其他租戶的聯絡人 ID 會寫進點擊紀錄與 link.clicked 事件（AUDIT RLS-07 的 code review）。
  // 交易綁定短連結的租戶，RLS 也會擋下其他租戶的聯絡人；這裡仍帶 tenantId（第一層）。
  // 不是 UUID 時當成匿名點擊（原本 clickLog.create 會拋錯，點擊默默沒被記錄）。
  let contactId: string | undefined;
  if (meta.contactId && CONTACT_ID_RE.test(meta.contactId)) {
    const own = await prisma.contact.findFirst({
      where: { id: meta.contactId, tenantId },
      select: { id: true },
    });
    contactId = own?.id;
  }
  if (meta.lineUid && link.lineChannelId) {
    const resolved = await resolveContactByLineUid(ctx, link.lineChannelId, meta.lineUid);
    if (resolved) contactId = resolved;
  }

  // 同一個 lineUid 並行點擊時，兩個交易都看不到對方未 commit 的 ClickLog，各自判成唯一點擊。
  // 以 (短連結, lineUid) 的交易級 advisory lock 排隊，後到的交易等前一個 commit 後才寫入與計數
  if (meta.lineUid) {
    await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`shortlink-click:${link.id}:${meta.lineUid}`}, 0))`;
  }

  await prisma.clickLog.create({
    data: {
      shortLinkId: link.id,
      contactId,
      lineUid: meta.lineUid,
      ip: meta.ip,
      userAgent: meta.userAgent,
      referer: meta.referer,
    },
  });

  // totalClicks always +1. uniqueClicks is +1 by default, UNLESS we have a
  // lineUid — then dedup by lineUid only (stable across network changes, so
  // the same LINE user stays a single unique). No lineUid (external browser,
  // or LIFF failed) → every click counts as a new unique.
  let isUnique = true;
  if (meta.lineUid) {
    const existing = await prisma.clickLog.count({ where: { shortLinkId: link.id, lineUid: meta.lineUid } });
    isUnique = existing <= 1;
  }

  const updated = await prisma.shortLink.update({
    where: { id: link.id },
    data: {
      totalClicks: { increment: 1 },
      ...(isUnique ? { uniqueClicks: { increment: 1 } } : {}),
    },
    select: { totalClicks: true, uniqueClicks: true },
  });

  // 點擊自動貼標（冪等），source='system'。貼標失敗不影響點擊：交易內的 SQL 錯誤會讓整個交易失效，
  // catch 擋不住，所以在 savepoint 內執行，失敗時只回滾貼標（與 member-binding 相同）
  let tagged: ContactTagged | null = null;
  if (contactId && link.tagOnClick) {
    const tagId = link.tagOnClick;
    await prisma.$executeRawUnsafe('SAVEPOINT shortlink_click_tag');
    try {
      const assignment = await addTagToTarget(ctx, { targetType: 'CONTACT', targetId: contactId, tagId, addedBy: 'system' });
      await prisma.$executeRawUnsafe('RELEASE SAVEPOINT shortlink_click_tag');
      tagged = { contactId, tagId, tagName: assignment.tag.name, source: 'system' };
    } catch (err) {
      await prisma.$executeRawUnsafe('ROLLBACK TO SAVEPOINT shortlink_click_tag');
      logger.warn('[ShortLink] auto-tag failed:', err);
    }
  }

  return { contactId, isUnique, totalClicks: updated.totalClicks, uniqueClicks: updated.uniqueClicks, tagged };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getClickStats(ctx: TenantCtx, shortLinkId: string) {
  const { tx: prisma, tenantId } = ctx;
  const link = await prisma.shortLink.findFirst({ where: { id: shortLinkId, tenantId } });
  if (!link) return null;

  // Daily click counts for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const clickLogs = await prisma.clickLog.findMany({
    where: { shortLinkId, createdAt: { gte: thirtyDaysAgo } },
    select: { id: true, createdAt: true, contactId: true, lineUid: true, referer: true },
    orderBy: { createdAt: 'asc' },
  });

  // Group by date
  const dailyMap: Record<string, { total: number; unique: Set<string> }> = {};
  const refererMap: Record<string, number> = {};

  for (const log of clickLogs) {
    const dateKey = log.createdAt.toISOString().slice(0, 10);
    if (!dailyMap[dateKey]) dailyMap[dateKey] = { total: 0, unique: new Set() };
    dailyMap[dateKey].total++;
    // Matches trackClick: dedup by lineUid when present; every click without a
    // lineUid is its own unique (the row id is a distinct per-click key).
    dailyMap[dateKey].unique.add(log.lineUid || log.id);

    const ref = log.referer || 'direct';
    refererMap[ref] = (refererMap[ref] || 0) + 1;
  }

  const timeSeries = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, total: v.total, unique: v.unique.size }));

  const sources = Object.entries(refererMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  const identifiedClicks = clickLogs.filter((l) => l.contactId || l.lineUid).length;
  const identificationRate = clickLogs.length > 0 ? identifiedClicks / clickLogs.length : 0;

  return {
    shortLinkId,
    totalClicks: link.totalClicks,
    uniqueClicks: link.uniqueClicks,
    identificationRate: Math.round(identificationRate * 100),
    timeSeries,
    sources,
  };
}

export async function getClickLogs(ctx: TenantCtx, shortLinkId: string, page = 1, limit = 50) {
  const { tx: prisma, tenantId } = ctx;
  const link = await prisma.shortLink.findFirst({ where: { id: shortLinkId, tenantId } });
  if (!link) return null;

  const [items, total] = await Promise.all([
    prisma.clickLog.findMany({
      where: { shortLinkId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.clickLog.count({ where: { shortLinkId } }),
  ]);

  return { items, total, page, limit };
}
