/**
 * 券的即時事件（add-coupon-system design D23）：收件匣右側「已發優惠券」區塊收到後重新載入。
 * 都是目前請求的直接結果、資料已寫入、房間已知，走 AGENTS.md 的 Path A（直接 emit）。
 */
export const COUPON_INSTANCE_UPDATED = 'coupon.instance.updated';

export type CouponInstanceChange = 'issued' | 'viewed' | 'redeemed';

/** fastify.io 的子集；測試可替換 */
export interface CouponEventEmitter {
  to(room: string): { emit(event: string, data: unknown): unknown };
}

export function emitCouponInstanceUpdated(
  io: CouponEventEmitter | undefined,
  tenantId: string,
  data: { instanceId: string; contactId: string | null; change: CouponInstanceChange },
): void {
  io?.to(`tenant:${tenantId}`).emit(COUPON_INSTANCE_UPDATED, data);
}
