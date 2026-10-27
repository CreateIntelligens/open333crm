/**
 * bull-board API 的操作白名單（change queue-monitoring，design 決策 4）。
 *
 * 只放行 GET 與單筆重送 failed job。清單只列放行的路由，bull-board 升級後新增的寫入路由預設被拒絕。
 * bull-board 的 retryJob 也接受 completed 的 job，所以這裡先查 job 的狀態。
 */
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { BeforeHook } from '@bull-board/api/dist/types.js';

/** 單筆重送的路由，以 bull-board 的路由樣式表示 */
export const RETRY_JOB_ROUTE = '/api/queues/:queueName/:jobId/retry';

const DENY = { allow: false, status: 403 } as const;

/** bull-board 傳入的 method 是小寫 */
export const allowQueueOperation: BeforeHook = async ({ method, route, request }) => {
  if (method === 'get') return { allow: true };
  if (method === 'put' && route === RETRY_JOB_ROUTE) {
    const { queueName, jobId } = request.params as { queueName?: string; jobId?: string };
    const job = await request.queues.get(queueName ?? '')?.getJob(jobId ?? '');
    if (job && (await job.getState()) === 'failed') return { allow: true };
  }
  return DENY;
};

/**
 * 重送固定從 failed 狀態移出 job。上面的 before hook 先讀狀態，bull-board 的 handler 再讀一次，
 * 兩次讀取之間 job 可能已被另一個重送請求重送並執行完成；handler 接受 completed。
 * BullMQ 的 reprocessJob 以 Lua 從指定的狀態集合移出 job，所以固定傳 failed 時，
 * job 已不在 failed set 就丟錯，不會重送（queue-monitoring「只放行讀取與重送單一個 failed job」）。
 */
export class FailedOnlyRetryAdapter extends BullMQAdapter {
  override async getJob(id: string) {
    const job = await super.getJob(id);
    if (job) {
      const retry = job.retry.bind(job);
      job.retry = (_state?: unknown) => retry('failed');
    }
    return job;
  }
}
