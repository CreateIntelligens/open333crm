/**
 * 營業時間的 flow（#337 階段 3 第九批，AGENTS.md 結構規則 2）。
 *
 * 修改營業時間時，稽核與修改在同一個交易寫入（主規格 tenant-audit-log）：稽核寫入失敗時，修改一起 rollback。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { getOfficeHours, updateOfficeHours, type OfficeHoursConfig } from './office-hours.service.js';

export const getOfficeHoursFlow = flowOf(getOfficeHours);

export function updateOfficeHoursFlow(
  deps: { prisma: PrismaClient },
  actor: RequestActor,
  timezone: string,
  officeHours: OfficeHoursConfig,
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await updateOfficeHours(scope, timezone, officeHours);
    // 只記變更的設定區塊，不放設定值
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'office-hours' },
      ip: actor.ip,
    });
    return result;
  });
}
