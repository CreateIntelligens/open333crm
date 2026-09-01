/**
 * Short link service — CRUD, click tracking, stats.
 */

import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { Server as SocketIOServer } from 'socket.io';
import { eventBus } from '../../events/event-bus.js';
import { logger } from '@open333crm/core';
import { scrapeOg } from './og-scraper.js';
import { addTagToTarget } from '../tag/tagging.service.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateSlug(length = 6): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

/** Ensure a lineChannelId belongs to this tenant and is a LINE channel. */
async function assertLineChannel(prisma: PrismaClient, tenantId: string, channelId: string): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'LINE' },
    select: { id: true },
  });
  if (!channel) throw new Error('lineChannelId 必須是本租戶的 LINE 渠道');
}

/**
 * Background OG snapshot: when no OG values were supplied manually, scrape the
 * target URL and patch the link. Fire-and-forget — never blocks create/update.
 */
function maybeScrapeOg(
  prisma: PrismaClient,
  linkId: string,
  targetUrl: string,
  provided: { ogTitle?: string; ogDescription?: string; ogImage?: string },
): void {
  if (provided.ogTitle || provided.ogDescription || provided.ogImage) return;
  void scrapeOg(targetUrl)
    .then(async (og) => {
      if (!og.ogTitle && !og.ogDescription && !og.ogImage) return;
      await prisma.shortLink.update({
        where: { id: linkId },
        data: { ogTitle: og.ogTitle, ogDescription: og.ogDescription, ogImage: og.ogImage },
      });
    })
    .catch((err) => logger.warn('[ShortLink] OG snapshot update failed:', (err as Error).message));
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listShortLinks(
  prisma: PrismaClient,
  tenantId: string,
  filters: { isActive?: string; q?: string; page?: number; limit?: number },
) {
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

export async function getShortLink(prisma: PrismaClient, id: string, tenantId: string) {
  return prisma.shortLink.findFirst({ where: { id, tenantId } });
}

export async function createShortLink(
  prisma: PrismaClient,
  tenantId: string,
  createdById: string,
  data: {
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
    expiresAt?: string;
  },
) {
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
    if (existing) throw new Error('Slug already in use');
  }

  if (data.lineChannelId) {
    await assertLineChannel(prisma, tenantId, data.lineChannelId);
  }

  const link = await prisma.shortLink.create({
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
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  });

  maybeScrapeOg(prisma, link.id, link.targetUrl, data);

  return link;
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
 * 回傳短連結對外網址；建立失敗（例如 URL 已是短連結）則回原 URL。
 */
export async function findOrCreateMaterialShortLink(
  prisma: PrismaClient,
  tenantId: string,
  createdById: string,
  params: { materialId: string; targetUrl: string; lineChannelId?: string | null; tagOnClick?: string | null },
): Promise<string> {
  const { materialId, targetUrl, lineChannelId, tagOnClick } = params;
  // 已是本站短連結 → 不二次包裝
  if (isOwnShortLink(targetUrl)) return targetUrl;

  // 複用同素材同目標的既有短連結；tagOnClick 有指定則同步更新（同 uri 取本次設定的標籤）
  const existing = await prisma.shortLink.findFirst({
    where: { tenantId, materialId, targetUrl, isActive: true },
    select: { id: true, slug: true, tagOnClick: true },
  });
  if (existing) {
    if (tagOnClick !== undefined && existing.tagOnClick !== tagOnClick) {
      await prisma.shortLink.update({ where: { id: existing.id }, data: { tagOnClick: tagOnClick ?? null } });
    }
    return shortLinkPublicUrl(existing.slug);
  }

  const link = await createShortLink(prisma, tenantId, createdById, {
    targetUrl,
    materialId,
    lineChannelId: lineChannelId ?? null,
    tagOnClick: tagOnClick ?? undefined,
  });
  return shortLinkPublicUrl(link.slug);
}

export async function updateShortLink(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
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
    expiresAt?: string | null;
  },
) {
  const link = await prisma.shortLink.findFirst({ where: { id, tenantId } });
  if (!link) return null;

  if (data.lineChannelId) {
    await assertLineChannel(prisma, tenantId, data.lineChannelId);
  }

  const updated = await prisma.shortLink.update({
    where: { id },
    data: {
      targetUrl: data.targetUrl,
      title: data.title,
      ogTitle: data.ogTitle,
      ogDescription: data.ogDescription,
      ogImage: data.ogImage,
      lineChannelId: data.lineChannelId === undefined ? undefined : data.lineChannelId || null,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmContent: data.utmContent,
      utmTerm: data.utmTerm,
      tagOnClick: data.tagOnClick,
      isActive: data.isActive,
      expiresAt: data.expiresAt === null ? null : data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  });

  // Re-snapshot OG when the target changed and no OG was supplied manually.
  if (data.targetUrl) {
    maybeScrapeOg(prisma, updated.id, updated.targetUrl, data);
  }

  return updated;
}

export async function deleteShortLink(prisma: PrismaClient, id: string, tenantId: string) {
  const link = await prisma.shortLink.findFirst({ where: { id, tenantId } });
  if (!link) return null;
  return prisma.shortLink.delete({ where: { id } });
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
export async function resolveContactByLineUid(
  prisma: PrismaClient,
  channelId: string,
  lineUid: string,
): Promise<string | null> {
  const identity = await prisma.channelIdentity.findUnique({
    where: { channelId_uid: { channelId, uid: lineUid } },
    select: { contactId: true },
  });
  return identity?.contactId ?? null;
}

// ─── Click Tracking (the single authoritative count) ─────────────────────────

/**
 * Record one click. This is the ONLY place a click is counted — invoked by the
 * front-end beacon/fetch to `POST /s/track`, never by the GET redirect handler.
 * Returns the resolved target URL (with UTM) so the LIFF page can complete the
 * redirect, or null if the link is missing/inactive/expired.
 */
export async function trackClick(
  prisma: PrismaClient,
  slug: string,
  meta: { contactId?: string; lineUid?: string; ip?: string; userAgent?: string; referer?: string },
  io?: SocketIOServer,
): Promise<string | null> {
  const link = await prisma.shortLink.findUnique({ where: { slug } });
  if (!link || !isLive(link)) return null;

  // Who actually clicked: the lineUid's contact wins; otherwise the cid from the URL.
  let contactId = meta.contactId;
  if (meta.lineUid && link.lineChannelId) {
    const resolved = await resolveContactByLineUid(prisma, link.lineChannelId, meta.lineUid);
    if (resolved) contactId = resolved;
  }

  const doAsync = async () => {
    try {
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

      if (io) {
        io.to(`tenant:${link.tenantId}`).emit('link.stats.updated', {
          shortLinkId: link.id,
          totalClicks: updated.totalClicks,
          uniqueClicks: updated.uniqueClicks,
        });
      }

      // 點擊自動貼標：收斂到共用 tagging.service（冪等 + 發 contact.tagged，
      // 讓「以貼標為觸發」的自動化也能被點擊路徑喚起）。source='system'。
      if (contactId && link.tagOnClick) {
        await addTagToTarget(prisma, {
          tenantId: link.tenantId,
          targetType: 'CONTACT',
          targetId: contactId,
          tagId: link.tagOnClick,
          addedBy: 'system',
        }).catch((err) => logger.warn('[ShortLink] auto-tag failed:', err));
      }

      eventBus.publish({
        name: 'link.clicked',
        tenantId: link.tenantId,
        timestamp: new Date(),
        payload: {
          shortLinkId: link.id,
          slug: link.slug,
          contactId,
          lineUid: meta.lineUid,
          isUnique,
        },
      });
    } catch (err) {
      logger.error('[ShortLink] Click tracking error:', err);
    }
  };

  // Fire-and-forget the writes; the target URL is computed synchronously.
  doAsync();

  return buildTargetUrl(link);
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getClickStats(
  prisma: PrismaClient,
  shortLinkId: string,
  tenantId: string,
) {
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

export async function getClickLogs(
  prisma: PrismaClient,
  shortLinkId: string,
  tenantId: string,
  page = 1,
  limit = 50,
) {
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
