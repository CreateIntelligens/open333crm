/**
 * 向 LINE 重抓聯絡人的名稱與頭像（spec line-contact-profile-sync）。
 * 呼叫 LINE 是外部呼叫，所以拆成「交易：讀渠道與身分 → 交易外：呼叫 LINE → 交易：寫入」（AGENTS.md 結構規則 2）。
 * 寫入是覆寫，重送沒有副作用，不需要認領。
 */
import type { PrismaClient } from '@prisma/client';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { inTenant } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { findLineProfileTarget, saveLineProfile, type LineProfile } from './line-profile.service.js';

export async function syncLineContactProfileFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
  channelId: string,
  lineUid: string,
) {
  const target = await inTenant(deps.prisma, tenantId, (scope) => findLineProfileTarget(scope, channelId, lineUid));

  const plugin = getChannelPlugin(CHANNEL_TYPE.LINE);
  if (!plugin) {
    throw new AppError('LINE 渠道模組無法使用，請聯繫系統管理員', 'INTERNAL_ERROR', 500);
  }

  let profile: LineProfile;
  try {
    profile = await plugin.getProfile(lineUid, target.credentials);
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

  return inTenant(deps.prisma, tenantId, (scope) => saveLineProfile(scope, target.identityId, channelId, profile));
}
