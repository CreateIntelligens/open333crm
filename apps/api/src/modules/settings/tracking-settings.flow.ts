/**
 * 追蹤設定（GA4／Meta Pixel）的 flow（#337 階段 3 第九批，AGENTS.md 結構規則 2）。
 *
 * 修改追蹤設定時，稽核與修改在同一個交易寫入（主規格 tenant-audit-log）：稽核寫入失敗時，修改一起 rollback。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { getTrackingSettings, updateTrackingSettings } from './tracking-settings.service.js';

export const getTrackingSettingsFlow = flowOf(getTrackingSettings);

export function updateTrackingSettingsFlow(
  deps: { prisma: PrismaClient },
  actor: RequestActor,
  data: { gaId: string | null; metaPixelId: string | null },
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const settings = await updateTrackingSettings(scope, data);
    // 只記有沒有設定 GA／Pixel，不放 ID 的值
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'tracking', gaIdSet: Boolean(data.gaId), metaPixelIdSet: Boolean(data.metaPixelId) },
      ip: actor.ip,
    });
    return settings;
  });
}
