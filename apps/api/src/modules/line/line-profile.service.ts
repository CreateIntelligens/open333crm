import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { notFound } from '../../shared/messages/resource.js';

export const LINE_CHANNEL_NOT_FOUND = '找不到此 LINE 渠道或渠道已停用，請至設定確認';

export interface LineProfile {
  displayName: string;
  avatarUrl?: string;
}

/**
 * 找出要重抓個人資料的身分與渠道憑證。
 * 渠道與身分都以 tenantId 限定：其他租戶、已停用或非 LINE 的渠道一律回 404（AUDIT RLS-05）。
 */
export async function findLineProfileTarget(ctx: TenantCtx, channelId: string, lineUid: string) {
  const channel = await ctx.tx.channel.findFirst({
    where: { id: channelId, tenantId: ctx.tenantId, isActive: true, channelType: CHANNEL_TYPE.LINE },
  });

  if (!channel) {
    throw new AppError(LINE_CHANNEL_NOT_FOUND, 'NOT_FOUND', 404);
  }

  const identity = await ctx.tx.channelIdentity.findFirst({
    where: { channelId, uid: lineUid, channel: { tenantId: ctx.tenantId } },
    select: { id: true },
  });

  if (!identity) {
    throw new AppError(notFound('channelIdentity'), 'NOT_FOUND', 404);
  }

  return { identityId: identity.id, credentials: decryptCredentials(channel.credentialsEncrypted) };
}

/** 只寫入 ChannelIdentity（不改 Contact）。身分在呼叫 LINE 期間被刪除時回 404。 */
export async function saveLineProfile(ctx: TenantCtx, identityId: string, channelId: string, profile: LineProfile) {
  const { count } = await ctx.tx.channelIdentity.updateMany({
    where: { id: identityId, channelId, channel: { tenantId: ctx.tenantId } },
    data: { profileName: profile.displayName, profilePic: profile.avatarUrl ?? null },
  });
  if (count === 0) {
    throw new AppError(notFound('channelIdentity'), 'NOT_FOUND', 404);
  }

  return ctx.tx.channelIdentity.findUniqueOrThrow({
    where: { id: identityId },
    select: { uid: true, profileName: true, profilePic: true },
  });
}
