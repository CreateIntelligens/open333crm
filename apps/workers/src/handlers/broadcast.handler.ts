import type { PrismaClient } from '@prisma/client';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { decryptCredentials } from '../lib/credentials.js';

async function executeBroadcast(
  prisma: PrismaClient,
  getPlugin: (channelType: string) => ChannelPlugin | undefined,
  broadcastId: string,
): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
  });

  if (!broadcast || broadcast.status !== 'scheduled') return;

  const channel = await prisma.channel.findUnique({ where: { id: broadcast.channelId } });
  if (!channel) {
    logger.warn(`[broadcast] Missing channel for broadcast ${broadcastId}`);
    return;
  }

  // 內容來源：優先 Material，舊資料 fallback Template
  let contentType = 'text';
  let body: Record<string, unknown> = {};
  if (broadcast.materialId) {
    const material = await prisma.material.findUnique({ where: { id: broadcast.materialId } });
    if (!material) {
      logger.warn(`[broadcast] Material ${broadcast.materialId} not found for broadcast ${broadcastId}`);
      return;
    }
    contentType = material.contentType;
    body = material.body as Record<string, unknown>;
  } else if (broadcast.templateId) {
    const template = await prisma.messageTemplate.findUnique({ where: { id: broadcast.templateId } });
    if (!template) {
      logger.warn(`[broadcast] Template ${broadcast.templateId} not found for broadcast ${broadcastId}`);
      return;
    }
    contentType = template.contentType;
    body = template.body as Record<string, unknown>;
  } else {
    logger.warn(`[broadcast] Broadcast ${broadcastId} has no content source`);
    return;
  }

  const plugin = getPlugin(channel.channelType);
  if (!plugin) {
    logger.warn(`[broadcast] No plugin registered for channel type ${channel.channelType}`);
    return;
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted as string);

  // Mark as sending
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'sending' as any },
  });

  // Resolve audience
  const identities = await prisma.channelIdentity.findMany({
    where: { channelId: broadcast.channelId },
    select: { uid: true },
  });

  let successCount = 0;
  let failCount = 0;

  for (const identity of identities) {
    try {
      // Use body as-is (simplified — no variable substitution at scheduler tier)
      await plugin.sendMessage(
        identity.uid,
        { contentType, content: body },
        credentials as Record<string, string>,
      );
      successCount++;
    } catch (err) {
      logger.error(`[broadcast] Failed to send to ${identity.uid}`, { err, broadcastId });
      failCount++;
    }
  }

  // Mark as sent
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'sent' as any },
  });

  logger.info(`[broadcast] Broadcast ${broadcastId} done: ${successCount} sent, ${failCount} failed`);
}

export async function handleBroadcastPoll(
  prisma: PrismaClient,
  getPlugin: (channelType: string) => ChannelPlugin | undefined,
): Promise<void> {
  const dueBroadcasts = await prisma.broadcast.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { lte: new Date() },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 10,
    select: { id: true },
  });

  if (dueBroadcasts.length === 0) return;

  logger.info(`[broadcast] Found ${dueBroadcasts.length} due broadcast(s)`);

  for (const { id } of dueBroadcasts) {
    try {
      await executeBroadcast(prisma, getPlugin, id);
    } catch (err) {
      logger.error(`[broadcast] executeBroadcast failed for ${id}`, { err });
    }
  }
}
