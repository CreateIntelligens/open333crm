import { getChannelPlugin } from '@open333crm/channel-plugins';
import type { TenantDb } from '../../lib/tenant-db.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { notFound } from '../../shared/messages/resource.js';

export const LINE_CHANNEL_NOT_FOUND = '找不到此 LINE 渠道或渠道已停用，請至設定確認';

/**
 * 向 LINE 重抓聯絡人的名稱與頭像，只寫入 ChannelIdentity（不改 Contact）。
 * 渠道與身分都以 tenantId 限定：其他租戶、已停用或非 LINE 的渠道一律回 404（AUDIT RLS-05）。
 */
export async function syncLineContactProfile(
  prisma: TenantDb,
  tenantId: string,
  channelId: string,
  lineUid: string,
): Promise<{ uid: string; profileName: string | null; profilePic: string | null }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, isActive: true, channelType: CHANNEL_TYPE.LINE },
  });

  if (!channel) {
    throw new AppError(LINE_CHANNEL_NOT_FOUND, 'NOT_FOUND', 404);
  }

  const identity = await prisma.channelIdentity.findFirst({
    where: { channelId, uid: lineUid, channel: { tenantId } },
    select: { id: true },
  });

  if (!identity) {
    throw new AppError(notFound('channelIdentity'), 'NOT_FOUND', 404);
  }

  const plugin = getChannelPlugin(CHANNEL_TYPE.LINE);
  if (!plugin) {
    throw new AppError('LINE 渠道模組無法使用，請聯繫系統管理員', 'INTERNAL_ERROR', 500);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);

  let profile: { uid: string; displayName: string; avatarUrl?: string };
  try {
    profile = await plugin.getProfile(lineUid, credentials);
  } catch (err) {
    // 管理員主動觸發的同步：原文放 details 供其排查（token 失效／額度用罄等），
    // message 維持可讀說明，不把第三方原文當成使用者訊息。
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(
      '無法取得 LINE 使用者資料，請稍後重試；若持續失敗請確認渠道權杖是否有效',
      'UPSTREAM_ERROR',
      502,
      { upstream: msg },
    );
  }

  const updated = await prisma.channelIdentity.update({
    where: { id: identity.id },
    data: {
      profileName: profile.displayName,
      profilePic: profile.avatarUrl ?? null,
    },
    select: { uid: true, profileName: true, profilePic: true },
  });

  return updated;
}
