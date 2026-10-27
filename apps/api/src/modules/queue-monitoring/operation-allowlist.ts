/**
 * bull-board API 的操作白名單（change queue-monitoring，design 決策 4）。
 *
 * 讀取與寫入都只放行列出的路由，bull-board 升級後新增的路由預設被拒絕：
 * - 讀取：只放行確認過不會回傳未遮蔽 job 資料的路由。job 的 log 是 processor 寫的任意文字，不放行。
 * - 寫入：只放行單筆重送 failed job。bull-board 的 retryJob 也接受 completed 的 job，所以這裡先查 job 的狀態。
 */
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { BeforeHook } from '@bull-board/api/dist/types.js';
import { maskJobData } from './mask-job-data.js';

/** 單筆重送的路由，以 bull-board 的路由樣式表示 */
export const RETRY_JOB_ROUTE = '/api/queues/:queueName/:jobId/retry';

/**
 * 放行的讀取路由。以 bull-board 9.10.4 逐條核對：job 資料都經過 setFormatter('data')，
 * 排程範本由 MonitoredQueueAdapter 遮蔽，其他路由不回傳 job 資料。升級 bull-board 時重新核對。
 */
export const ALLOWED_READ_ROUTES: ReadonlySet<string> = new Set([
  '/api/redis/stats',
  '/api/queues',
  '/api/queues/has-workers',
  '/api/job-schedulers',
  '/api/queues/:queueName/metrics',
  '/api/queues/:queueName/default-job-options',
  '/api/queues/:queueName/workers',
  '/api/queues/:queueName/rate-limit',
  '/api/queues/:queueName/job-data-schema',
  '/api/queues/:queueName/:jobId/flow',
  '/api/queues/:queueName/:jobId',
]);

const DENY = { allow: false, status: 403 } as const;

/** bull-board 傳入的 method 是小寫 */
export const allowQueueOperation: BeforeHook = async ({ method, route, request }) => {
  if (method === 'get') return ALLOWED_READ_ROUTES.has(route) ? { allow: true } : DENY;
  if (method === 'put' && route === RETRY_JOB_ROUTE) {
    const { queueName, jobId } = request.params as { queueName?: string; jobId?: string };
    const job = await request.queues.get(queueName ?? '')?.getJob(jobId ?? '');
    if (job && (await job.getState()) === 'failed') return { allow: true };
  }
  return DENY;
};

/**
 * 監控用的 adapter，補上 bull-board 本身沒有的兩項限制：
 * - 重送固定從 failed 狀態移出 job。上面的 before hook 先讀狀態，bull-board 的 handler 再讀一次，
 *   兩次讀取之間 job 可能已被另一個重送請求重送並執行完成；handler 接受 completed。
 *   BullMQ 的 reprocessJob 以 Lua 從指定的狀態集合移出 job，所以固定傳 failed 時，
 *   job 已不在 failed set 就丟錯，不會重送（queue-monitoring「只放行讀取與重送單一個 failed job」）。
 * - 排程範本的資料：bull-board 直接回傳 template，不經過 setFormatter('data')，所以在這裡遮蔽。
 */
export class MonitoredQueueAdapter extends BullMQAdapter {
  override async getJob(id: string) {
    const job = await super.getJob(id);
    if (job) {
      const retry = job.retry.bind(job);
      job.retry = (_state?: unknown) => retry('failed');
    }
    return job;
  }

  override async getJobSchedulers() {
    const schedulers = await super.getJobSchedulers();
    return schedulers.map((scheduler) =>
      scheduler.template ? { ...scheduler, template: { ...scheduler.template, data: maskJobData(scheduler.template.data) } } : scheduler,
    );
  }
}
