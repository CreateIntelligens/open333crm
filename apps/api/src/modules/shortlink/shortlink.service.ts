/**
 * Short link service — CRUD, click tracking, stats.
 */

import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { eventBus } from '../../events/event-bus.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateSlug(length = 6): string {
  return randomBytes(length).toString('base64url').slice(0, length);
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
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    tagOnClick?: string;
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

  return prisma.shortLink.create({
    data: {
      tenantId,
      createdById,
      slug: slug!,
      targetUrl: data.targetUrl,
      title: data.title,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmContent: data.utmContent,
      utmTerm: data.utmTerm,
      tagOnClick: data.tagOnClick,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  });
}

export async function updateShortLink(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    targetUrl?: string;
    title?: string;
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

  return prisma.shortLink.update({
    where: { id },
    data: {
      targetUrl: data.targetUrl,
      title: data.title,
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
}

export async function deleteShortLink(prisma: PrismaClient, id: string, tenantId: string) {
  const link = await prisma.shortLink.findFirst({ where: { id, tenantId } });
  if (!link) return null;
  return prisma.shortLink.delete({ where: { id } });
}

// ─── Click Tracking ─────────────────────────────────────────────────────────

export async function handleClick(
  prisma: PrismaClient,
  slug: string,
  meta: { contactId?: string; ip?: string; userAgent?: string; referer?: string },
) {
  const link = await prisma.shortLink.findUnique({ where: { slug } });
  if (!link || !link.isActive) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;

  // Async: create click log, increment counters, auto-tag
  const doAsync = async () => {
    try {
      // Create click log
      await prisma.clickLog.create({
        data: {
          shortLinkId: link.id,
          contactId: meta.contactId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          referer: meta.referer,
        },
      });

      // Check uniqueness (by contactId or ip)
      let isUnique = false;
      if (meta.contactId) {
        const existing = await prisma.clickLog.count({
          where: { shortLinkId: link.id, contactId: meta.contactId },
        });
        isUnique = existing <= 1; // current click is already counted
      } else if (meta.ip) {
        const existing = await prisma.clickLog.count({
          where: { shortLinkId: link.id, ip: meta.ip },
        });
        isUnique = existing <= 1;
      }

      // Increment counters
      await prisma.shortLink.update({
        where: { id: link.id },
        data: {
          totalClicks: { increment: 1 },
          ...(isUnique ? { uniqueClicks: { increment: 1 } } : {}),
        },
      });

      // Auto-tag contact
      if (meta.contactId && link.tagOnClick) {
        const existing = await prisma.contactTag.findFirst({
          where: { contactId: meta.contactId, tagId: link.tagOnClick },
        });
        if (!existing) {
          await prisma.contactTag.create({
            data: {
              contactId: meta.contactId,
              tagId: link.tagOnClick,
              addedBy: 'system',
            },
          });
        }
      }

      // Publish event
      eventBus.publish({
        name: 'link.clicked',
        tenantId: link.tenantId,
        timestamp: new Date(),
        payload: {
          shortLinkId: link.id,
          slug: link.slug,
          contactId: meta.contactId,
          isUnique,
        },
      });
    } catch (err) {
      console.error('[ShortLink] Click tracking error:', err);
    }
  };

  // Fire-and-forget
  doAsync();

  // Build redirect URL with UTM params
  const url = new URL(link.targetUrl);
  if (link.utmSource) url.searchParams.set('utm_source', link.utmSource);
  if (link.utmMedium) url.searchParams.set('utm_medium', link.utmMedium);
  if (link.utmCampaign) url.searchParams.set('utm_campaign', link.utmCampaign);
  if (link.utmContent) url.searchParams.set('utm_content', link.utmContent);
  if (link.utmTerm) url.searchParams.set('utm_term', link.utmTerm);

  return url.toString();
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
    select: { createdAt: true, contactId: true, referer: true },
    orderBy: { createdAt: 'asc' },
  });

  // Group by date
  const dailyMap: Record<string, { total: number; unique: Set<string> }> = {};
  const refererMap: Record<string, number> = {};

  for (const log of clickLogs) {
    const dateKey = log.createdAt.toISOString().slice(0, 10);
    if (!dailyMap[dateKey]) dailyMap[dateKey] = { total: 0, unique: new Set() };
    dailyMap[dateKey].total++;
    const identifier = log.contactId || 'anonymous';
    dailyMap[dateKey].unique.add(identifier);

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

  const identifiedClicks = clickLogs.filter((l) => l.contactId).length;
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
