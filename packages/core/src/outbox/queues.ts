/**
 * outbox 送出的佇列：訂閱者佇列的名稱、訂閱的事件與 job 選項（design 決策 4）。
 *
 * 每個訂閱者一個佇列，job id 直接用事件 id；bullmq 不接受只含一個 `:` 的自訂 id，
 * 需要組合 id 時用 `__` 分隔。
 */
import { Queue, type JobsOptions } from 'bullmq';
import { EXTERNAL_EVENT_NAMES, type AppEventName } from './events.js';

export const EVENT_NOTIFICATION_QUEUE = 'event-notification';
export const EVENT_AUTOMATION_QUEUE = 'event-automation';
export const EVENT_WEBHOOK_QUEUE = 'event-webhook';
/** 對外 webhook：每個事件、每個訂閱網址一個 job（design 決策 11） */
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
/** 用量告警信：每個事件、每位管理員一個 job（design 決策 10） */
export const USAGE_ALERT_EMAIL_QUEUE = 'usage-alert-email';

const NOTIFICATION_EVENTS: ReadonlySet<string> = new Set<AppEventName>([
  'case.assigned',
  'case.escalated',
  'sla.warning',
  'sla.breached',
  'message.received',
  'conversation.assigned',
  'usage.quota.threshold',
]);

// TODO(outbox-event-delivery 8.11)：keyword.matched 改由 workers 處理 message.received 時直接比對
// （design 決策 9），之後從這裡移除
const AUTOMATION_EVENTS: ReadonlySet<string> = new Set<AppEventName>([
  'message.received',
  'keyword.matched',
  'case.created',
  'conversation.created',
  'contact.tagged',
  'contact.created',
  'case.escalated',
  'portal.activity.submitted',
  'link.clicked',
]);

export const EVENT_SUBSCRIBERS: ReadonlyArray<{ queue: string; events: ReadonlySet<string> }> = [
  { queue: EVENT_NOTIFICATION_QUEUE, events: NOTIFICATION_EVENTS },
  { queue: EVENT_AUTOMATION_QUEUE, events: AUTOMATION_EVENTS },
  { queue: EVENT_WEBHOOK_QUEUE, events: EXTERNAL_EVENT_NAMES },
];

/** 訂閱了這個事件名稱的訂閱者佇列 */
export function subscriberQueuesOf(eventName: string): string[] {
  return EVENT_SUBSCRIBERS.filter((s) => s.events.has(eventName)).map((s) => s.queue);
}

/**
 * 訂閱者 job 的選項。完成的 job 保留 24 小時：這段時間內以同一個事件 id 再送一次，BullMQ 不會建立新 job。
 * 訂閱者都能承受同一個事件處理兩次，所以可以重試。
 */
export const SUBSCRIBER_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
};

/** 訂閱者 job 的資料。job data 是 JSON，所以 timestamp 是 ISO 8601 字串 */
export interface EventJobData {
  eventId: string;
  name: string;
  tenantId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

/** 送出 job 只需要 add()；測試以假的實作取代 */
export interface JobSink {
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>;
}

export type GetQueue = (queueName: string) => JobSink;

// 延遲建立：import core 不連 Redis（#327）
const queues = new Map<string, Queue>();

export const getOutboxQueue: GetQueue = (queueName) => {
  let queue = queues.get(queueName);
  if (!queue) {
    queue = new Queue(queueName, { connection: { url: process.env.REDIS_URL! } });
    queues.set(queueName, queue);
  }
  return queue;
};

/** 關閉這個模組建立的佇列連線（優雅關機與測試用） */
export async function closeOutboxQueues(): Promise<void> {
  const all = [...queues.values()];
  queues.clear();
  await Promise.all(all.map((q) => q.close()));
}
