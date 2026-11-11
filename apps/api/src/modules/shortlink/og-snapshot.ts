/**
 * 短連結的 OG 快照（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 抓目標網址的 OG 是外部呼叫，不能在交易內做。建立或修改短連結的交易 commit 之後，
 * 呼叫端以 scope.afterCommit 呼叫 snapshotOgInBackground：在背景抓取，再另開交易寫回。
 *
 * 保證：最多一次，盡力而為。不等待、不重試；抓取或寫回失敗只記 log，短連結照常可用，
 * 機器人預覽改用短連結的標題（bot.strategy.ts）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { scrapeOg, type OgSnapshot } from './og-scraper.js';
import { saveShortLinkOg } from './shortlink.service.js';

/** 在背景抓 OG，交給 write 寫回；立即回傳，不等待 */
export function snapshotOgInBackground(
  link: { id: string; targetUrl: string },
  write: (og: OgSnapshot) => Promise<unknown>,
): void {
  void scrapeOg(link.targetUrl)
    .then(write)
    .catch((err) => logger.warn('[ShortLink] OG snapshot update failed:', (err as Error).message));
}

/** 以新的交易寫回 OG 快照：flow 與附券廣播在 commit 之後使用 */
export function writeOgInTenant(prisma: PrismaClient, tenantId: string, link: { id: string; targetUrl: string }) {
  return (og: OgSnapshot) => inTenant(prisma, tenantId, (scope) => saveShortLinkOg(scope, link, og));
}
