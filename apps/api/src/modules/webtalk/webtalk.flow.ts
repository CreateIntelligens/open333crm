/**
 * WebTalk 設定的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 修改設定與重新產生房間代號時，稽核與修改在同一個交易寫入（主規格 tenant-audit-log）：
 * 稽核寫入失敗時，修改一起 rollback。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  buildWebTalkSession,
  getWebTalkSettings,
  rotateWebTalkRoom,
  updateWebTalkSettings,
  type WebTalkServerConfig,
  type WebTalkSession,
  type WebTalkSettings,
} from './webtalk.service.js';

export const getWebTalkSettingsFlow = flowOf(getWebTalkSettings);

/** 伺服器沒有設定 WebTalk 時直接回傳 NOT_CONFIGURED，不開交易（與 buildWebTalkSession 相同） */
export async function buildWebTalkSessionFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
  config: WebTalkServerConfig | null,
): Promise<WebTalkSession> {
  if (!config) return { enabled: false, reason: 'NOT_CONFIGURED' };
  return inTenant(deps.prisma, tenantId, (scope) => buildWebTalkSession(scope, config));
}

export function updateWebTalkSettingsFlow(
  deps: { prisma: PrismaClient },
  actor: RequestActor,
  patch: Partial<WebTalkSettings>,
): Promise<WebTalkSettings> {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await updateWebTalkSettings(scope, patch);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'webtalk', enabled: result.enabled, aiEnabled: result.aiEnabled },
      ip: actor.ip,
    });
    return result;
  });
}

export function rotateWebTalkRoomFlow(deps: { prisma: PrismaClient }, actor: RequestActor): Promise<void> {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await rotateWebTalkRoom(scope);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'webtalk', rotateRoom: true },
      ip: actor.ip,
    });
  });
}
