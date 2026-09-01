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
  lineRichMenuId: string;
  uids: string[];
  op: 'link' | 'unlink';
}

export async function handleRichMenuBindJob(
  job: Job,
  prisma: PrismaClient,
  pluginRegistry: Map<string, ChannelPlugin>,
): Promise<void> {
  const { tenantId, channelId, lineRichMenuId, uids, op } = job.data as RichMenuBindJobData;
  if (!uids || uids.length === 0) return;

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
