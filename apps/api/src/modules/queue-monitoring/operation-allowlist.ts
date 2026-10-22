/**
 * bull-board API 的操作白名單（change queue-monitoring，design 決策 4）。
 *
 * 只放行 GET 與單筆重送 failed job。清單只列放行的路由，bull-board 升級後新增的寫入路由預設被拒絕。
 * bull-board 的 retryJob 也接受 completed 的 job，所以這裡先查 job 的狀態。
 */
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
