import type { PrismaClient } from '@prisma/client';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

export async function syncLineContactProfile(
  prisma: PrismaClient,
  channelId: string,
  lineUid: string,
): Promise<{ uid: string; profileName: string | null; profilePic: string | null }> {
  const identity = await prisma.channelIdentity.findUnique({
    where: { channelId_uid: { channelId, uid: lineUid } },
  });

  if (!identity) {
    throw new AppError('ChannelIdentity not found', 'NOT_FOUND', 404);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, isActive: true },
  });

  if (!channel) {
    throw new AppError('Channel not found or inactive', 'NOT_FOUND', 404);
  }

  const plugin = getChannelPlugin(CHANNEL_TYPE.LINE);
  if (!plugin) {
    throw new AppError('LINE plugin not available', 'INTERNAL_ERROR', 500);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);

  let profile: { uid: string; displayName: string; avatarUrl?: string };
  try {
    profile = await plugin.getProfile(lineUid, credentials);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(`LINE API error: ${msg}`, 'UPSTREAM_ERROR', 502);
  }

  const updated = await prisma.channelIdentity.update({
    where: { channelId_uid: { channelId, uid: lineUid } },
    data: {
      profileName: profile.displayName,
      profilePic: profile.avatarUrl ?? null,
    },
    select: { uid: true, profileName: true, profilePic: true },
  });

  return updated;
}
