/**
 * 後台核銷台的入口（change migrate-role-agent-tenant-ctx，design 決策 7、8）。
 *
 * 以 inTenant() 開交易，呼叫只收 TenantCtx 的 redeemCoupon()；成功時 commit 後推播券狀態更新
 * （add-coupon-system design D23）。核銷的其他入口（票券夾、門市核銷台）在各自的 flow 推播。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant } from '../../lib/tenant-ctx.js';
import { redeemCoupon, type RedeemInput } from './coupon-redeem.service.js';
import { notifyInstanceUpdated } from './coupon-effects.js';

export interface RedeemFlowDeps {
  prisma: PrismaClient;
  io: Server;
}

export function redeemAtConsole(deps: RedeemFlowDeps, tenantId: string, input: RedeemInput) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const result = await redeemCoupon(scope, input);
    if (result.ok) notifyInstanceUpdated(scope, deps.io, { instanceId: result.instanceId, contactId: result.contactId, change: 'redeemed' });
    return result;
  });
}
