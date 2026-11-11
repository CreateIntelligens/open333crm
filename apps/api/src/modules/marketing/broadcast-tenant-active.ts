/**
 * 停用租戶的群發不送出（issue #410，AUDIT AUTH-11；change stop-disabled-tenant-activity-410）。
 *
 * 租戶停用（平台手動停用或試用到期）之後，排程器到期的群發與 coupon-broadcast 佇列的附券群發都不送出：
 * 群發標為失敗並寫 failureCode／failureReason，後台列表看得到；不保留 scheduled，
 * 避免租戶重新啟用後突然送出過期的內容。做法與 broadcast-send-authority.ts 的發送權限重驗相同。
 *
 * 查詢收 TenantCtx（AGENTS.md 結構規則 2）；rejectDisabledTenantSend 是入口（排程器、佇列 job）用的函式。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';

export const TENANT_DISABLED_FAILURE = {
  code: 'TENANT_DISABLED',
  reason: '租戶已停用，群發未送出。租戶重新啟用後，請確認內容再重新發送',
} as const;

/** 租戶是否啟用；查不到視為停用 */
export async function isBroadcastTenantActive(ctx: TenantCtx): Promise<boolean> {
  const tenant = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { isActive: true } });
  return tenant?.isActive === true;
}

/**
 * 把排程群發標為失敗（不送出）。條件更新只動仍是 scheduled 的群發：已在發送中（sending）或已結束的群發不覆寫。
 * 回傳是否有更新。
 */
export async function markTenantDisabledBroadcast(ctx: TenantCtx, broadcastId: string): Promise<boolean> {
  const updated = await ctx.tx.broadcast.updateMany({
    where: { id: broadcastId, tenantId: ctx.tenantId, status: 'scheduled' },
    data: { status: 'failed', failureCode: TENANT_DISABLED_FAILURE.code, failureReason: TENANT_DISABLED_FAILURE.reason },
  });
  return updated.count > 0;
}

/**
 * 租戶停用時把群發標為失敗並回傳 true（呼叫端不送出）；租戶啟用時回 false。
 * 檢查與發送的搶占不在同一個交易：兩者之間的毫秒內停用時仍會送出，與 webhook 提早丟棄相同。
 */
export async function rejectDisabledTenantSend(
  deps: { prisma: PrismaClient },
  tenantId: string,
  broadcastId: string,
): Promise<boolean> {
  return inTenant(deps.prisma, tenantId, async (ctx) => {
    if (await isBroadcastTenantActive(ctx)) return false;
    const marked = await markTenantDisabledBroadcast(ctx, broadcastId);
    logger.warn('[Broadcast] 租戶已停用，群發沒有送出', { tenantId, broadcastId, marked });
    return true;
  });
}
