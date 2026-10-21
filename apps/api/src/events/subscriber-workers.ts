/**
 * API 行程內的訂閱者 Worker（change outbox-event-delivery，design 決策 4）。
 *
 * 通知、自動化與對外 webhook 各有一個佇列，job id 是事件 id。訂閱者在 API 行程處理：
 * 自動化要用 fastify.io 推播，也要呼叫 api 的 service。job 失敗時 BullMQ 只重試那個佇列的 job，
 * 其他訂閱者不會再處理同一個事件。
 */
import { Worker, type Job, type WorkerOptions } from 'bullmq';
import { logger, type EventJobData } from '@open333crm/core';
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
  return (job) => handler(appEventFromJob(job.data as EventJobData));
}

export type CreateWorker = (queue: string, processor: JobProcessor) => { close(): Promise<void> };

/** options：個別佇列的 Worker 設定，例如 webhook-delivery 的自訂重試間隔 */
export function bullWorkerFactory(redisUrl: string, options: Record<string, Partial<WorkerOptions>> = {}): CreateWorker {
  return (queue, processor) => {
    const worker = new Worker(queue, processor, { ...options[queue], connection: { url: redisUrl } });
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
