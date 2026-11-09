/**
 * Rich Menu 分眾綁定背景 handler（queue: rich-menu-bind）。
 *
 * API 端 bindRichMenuToAudience 解析出受眾 uid 後入此 job；這裡取 channel 憑證，
 * 呼叫 plugin.linkMenuToUsers / unlinkMenuFromUsers（已自動每 500 分批 + LINE bulk API）。
 * 走背景是因為受眾可能上千、LINE bulk-link 有 rate limit，同步跑會逾時/撞限。
 */
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { decryptCredentials } from '../lib/credentials.js';

interface RichMenuBindJobData {
  tenantId: string;
  channelId: string;
  /** 部署前送出的工作沒有這個欄位 */
  richMenuId?: string;
  lineRichMenuId: string;
  uids: string[];
  op: 'link' | 'unlink';
}

export async function handleRichMenuBindJob(
  job: Job,
  prisma: PrismaClient,
  pluginRegistry: Map<string, ChannelPlugin>,
): Promise<void> {
  const { tenantId, channelId, richMenuId, lineRichMenuId, uids, op } = job.data as RichMenuBindJobData;
  if (!uids || uids.length === 0) return;

  // 綁定工作至少送出一次，可能晚於取消發布或重新發布才執行：選單已不是這個 LINE 選單時跳過
  // （spec line-rich-menu「背景綁定只綁到仍在發布中的選單」）。解除綁定讓客人回到全體預設，不檢查。
  if (op === 'link' && richMenuId) {
    const menu = await prisma.richMenu.findFirst({
      where: { id: richMenuId, tenantId },
      select: { status: true, lineRichMenuId: true },
    });
    if (menu?.status !== 'published' || menu.lineRichMenuId !== lineRichMenuId) {
      logger.info(`[rich-menu-bind] skip stale bind menu=${richMenuId} lineRichMenuId=${lineRichMenuId} (tenant ${tenantId})`);
      return;
    }
  }

  // 驗證 channel 屬本租戶 + 取憑證
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'LINE' },
    select: { credentialsEncrypted: true },
  });
  if (!channel?.credentialsEncrypted) {
    logger.error(`[rich-menu-bind] channel ${channelId} not found or no credentials (tenant ${tenantId})`);
    return;
  }

  const plugin = pluginRegistry.get('LINE');
  // rich menu 綁定方法在 plugin.extensions.ui（ChannelUiExtension），非 plugin 主介面。
  const ui = plugin?.extensions?.ui;
  if (!ui?.linkMenuToUsers || !ui?.unlinkMenuFromUsers) {
    logger.error('[rich-menu-bind] LINE plugin ui rich-menu extension not available');
    return;
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);

  if (op === 'link') {
    await ui.linkMenuToUsers(uids, lineRichMenuId, credentials);
    logger.info(`[rich-menu-bind] linked menu ${lineRichMenuId} to ${uids.length} users`);
  } else {
    await ui.unlinkMenuFromUsers(uids, credentials);
    logger.info(`[rich-menu-bind] unlinked ${uids.length} users from their menu`);
  }
}
