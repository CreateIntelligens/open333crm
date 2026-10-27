/**
 * 立即執行附券廣播的 job（change fix-coupon-broadcast-immediate-run）。
 *
 * queueCouponBroadcast() 在排入發送的交易裡寫進 outbox，commit 後送進 coupon-broadcast 佇列，
 * 這裡在 API 行程收到後馬上執行 runCouponBroadcast()（要用 fastify.io 推播與 app_tenant 連線）。
 * 每分鐘的排程（broadcast.scheduler.ts）是後備；兩者誰先搶占誰發送，另一個回 not_claimed、不做事。
 *
 * 錯誤不在這裡吞掉：搶占前失敗時讓佇列重試；搶占後的錯誤 runCouponBroadcast 已把原因寫進廣播
 * （後台看得到），重試時搶不到，不會重複發送。
 */
import type { Job } from 'bullmq';
import type { CouponBroadcastJobData } from './broadcast-coupon.service.js';

export type RunCouponBroadcast = (tenantId: string, broadcastId: string) => Promise<unknown>;

export function createCouponBroadcastProcessor(run: RunCouponBroadcast) {
  return async (job: Job): Promise<unknown> => {
    const { tenantId, broadcastId } = (job.data ?? {}) as Partial<CouponBroadcastJobData>;
    if (typeof tenantId !== 'string' || typeof broadcastId !== 'string') {
      throw new Error('coupon-broadcast job 缺少 tenantId 或 broadcastId');
    }
    return run(tenantId, broadcastId);
  };
}
