/**
 * API 行程內的訂閱者 Worker（change outbox-event-delivery，design 決策 4）。
 *
 * 通知、自動化與對外 webhook 各有一個佇列，job id 是事件 id。訂閱者在 API 行程處理：
 * 自動化要用 fastify.io 推播，也要呼叫 api 的 service。job 失敗時 BullMQ 只重試那個佇列的 job，
 * 其他訂閱者不會再處理同一個事件。
 */
import { Worker, type Job, type WorkerOptions } from 'bullmq';
import {
  collectSkippedClaims,
  EVENT_AUTOMATION_QUEUE,
  logger,
  WEBHOOK_DELIVERY_QUEUE,
  type EventJobData,
  type SkippedClaim,
} from '@open333crm/core';
import { appEventFromJob, type AppEvent, type AppEventName } from './event-bus.js';

/** 訂閱者收到的事件：比 AppEvent 多了事件 id，衍生的認領鍵與 job id 都用它 */
export type SubscribedEvent = AppEvent & { id: string };
export type EventHandler = (event: SubscribedEvent) => Promise<void>;

/** 依事件名稱分派給處理程式；沒有處理程式的名稱直接略過 */
export function createEventRouter() {
  const handlers = new Map<string, EventHandler>();
  return {
    on(name: AppEventName, handler: EventHandler): void {
      handlers.set(name, handler);
    },
    names(): string[] {
      return [...handlers.keys()];
    },
    handle: async (event: SubscribedEvent): Promise<void> => {
      await handlers.get(event.name)?.(event);
    },
  };
}

export type JobProcessor = (job: Job) => Promise<unknown>;

/** 訂閱者佇列的 processor：job data 轉回事件（timestamp 轉回 Date）再交給處理程式 */
export function subscriberProcessor(handler: EventHandler): JobProcessor {
  return (job) => withSkippedClaims(() => handler(appEventFromJob(job.data as EventJobData)));
}

/**
 * 以 job 的回傳值列出被認領擋下的副作用：管理員在佇列監控重送 job 之後，看得出哪些副作用沒有再執行
 * （change queue-monitoring，design 決策 7）。沒有跳過時回傳 undefined。
 */
export async function withSkippedClaims(fn: () => Promise<void>): Promise<{ skippedClaims: SkippedClaim[] } | undefined> {
  const { skippedClaims } = await collectSkippedClaims(fn);
  return skippedClaims.length > 0 ? { skippedClaims } : undefined;
}

export type CreateWorker = (queue: string, processor: JobProcessor) => { close(): Promise<void> };

/**
 * 每個 Worker 同時處理的 job 數。BullMQ 預設是 1：一個事件的 AI 回覆跑幾十秒時，其他租戶的事件都要等。
 * 自動化（呼叫 LLM）與 webhook-delivery（每次 HTTP 最多等 10 秒）比較慢，所以設得比較高。
 */
const WORKER_CONCURRENCY: Record<string, number> = { [EVENT_AUTOMATION_QUEUE]: 10, [WEBHOOK_DELIVERY_QUEUE]: 10 };
const DEFAULT_WORKER_CONCURRENCY = 5;

/** options：個別佇列的 Worker 設定，例如 webhook-delivery 的自訂重試間隔 */
export function bullWorkerFactory(redisUrl: string, options: Record<string, Partial<WorkerOptions>> = {}): CreateWorker {
  return (queue, processor) => {
    const worker = new Worker(queue, processor, {
      concurrency: WORKER_CONCURRENCY[queue] ?? DEFAULT_WORKER_CONCURRENCY,
      ...options[queue],
      connection: { url: redisUrl },
    });
    worker.on('failed', (job, err) => {
      logger.error(`[${queue}] job ${job?.id} 失敗（第 ${job?.attemptsMade ?? '?'} 次）`, err);
    });
    // 必須註冊：沒有 error listener 時，Redis 斷線會變成 uncaught error
    worker.on('error', (err) => logger.error(`[${queue}] Worker 錯誤`, err));
    return worker;
  };
}

/** 為每個佇列建立一個 Worker */
export function startQueueWorkers(processors: Record<string, JobProcessor>, createWorker: CreateWorker) {
  const workers = Object.entries(processors).map(([queue, processor]) => createWorker(queue, processor));
  return {
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
