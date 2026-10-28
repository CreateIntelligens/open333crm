/**
 * shortlink 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：後台的短連結管理，以及公開的點擊記錄。
 *
 * - 建立、修改目標網址時，沒有手動填 OG 就在 commit 之後抓 OG 快照（og-snapshot.ts，最多一次）。
 * - 點擊記錄：點擊紀錄、次數與點擊貼標在同一個交易，租戶取自短連結。
 *   link.clicked、contact.tagged 與點擊一起寫進 outbox，commit 之後送出（至少一次）；
 *   link.stats.updated 在 commit 之後推播。
 */
import type { PrismaClient, ShortLink } from '@prisma/client';
import type { Server } from 'socket.io';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import { notifyTenant } from '../../events/socket-push.js';
import { createOutboxPublisher, publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import { publishContactTagged } from '../tag/tag-effects.js';
import {
  createShortLink,
  deleteShortLink,
  getClickLogs,
  getClickStats,
  getShortLink,
  listShortLinks,
  needsOgSnapshot,
  recordClick,
  updateShortLink,
  type ClickMeta,
  type CreateShortLinkInput,
} from './shortlink.service.js';
import { snapshotOgInBackground, writeOgInTenant } from './og-snapshot.js';

export interface ShortLinkFlowDeps {
  prisma: PrismaClient;
}

export interface TrackClickFlowDeps {
  prisma: PrismaClient;
  io: Server;
  /** 單元測試注入假的實作；沒有給時用 outbox */
  events?: EventPublisher;
}

export const listShortLinksFlow = flowOf(listShortLinks);
export const getShortLinkFlow = flowOf(getShortLink);
export const deleteShortLinkFlow = flowOf(deleteShortLink);
export const getClickStatsFlow = flowOf(getClickStats);
export const getClickLogsFlow = flowOf(getClickLogs);

export function createShortLinkFlow(
  deps: ShortLinkFlowDeps,
  tenantId: string,
  createdById: string,
  data: CreateShortLinkInput,
) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const link = await createShortLink(scope, createdById, data);
    if (needsOgSnapshot(data)) {
      scope.afterCommit('og snapshot', () => snapshotOgInBackground(link, writeOgInTenant(deps.prisma, tenantId, link.id)));
    }
    return link;
  });
}

export function updateShortLinkFlow(
  deps: ShortLinkFlowDeps,
  tenantId: string,
  id: string,
  data: Parameters<typeof updateShortLink>[2],
) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const updated = await updateShortLink(scope, id, data);
    if (updated && data.targetUrl && needsOgSnapshot(data)) {
      scope.afterCommit('og snapshot', () => snapshotOgInBackground(updated, writeOgInTenant(deps.prisma, tenantId, updated.id)));
    }
    return updated;
  });
}

/** 記錄一次點擊。link 由公開路由以 slug 查出（getLinkForRedirect），交易綁定 link 所屬的租戶 */
export function trackClickFlow(deps: TrackClickFlowDeps, link: ShortLink, meta: ClickMeta) {
  return inTenant(deps.prisma, link.tenantId, async (scope) => {
    const events = deps.events ?? createOutboxPublisher(deps.prisma);
    const click = await recordClick(scope, link, meta);
    notifyTenant(scope, deps.io, 'link.stats.updated', {
      shortLinkId: link.id,
      totalClicks: click.totalClicks,
      uniqueClicks: click.uniqueClicks,
    });
    if (click.tagged) await publishContactTagged(scope, events, click.tagged);
    await publishEvent(scope, events, 'link.clicked', {
      shortLinkId: link.id,
      slug: link.slug,
      contactId: click.contactId,
      lineUid: meta.lineUid,
      isUnique: click.isUnique,
    });
    return click;
  });
}
