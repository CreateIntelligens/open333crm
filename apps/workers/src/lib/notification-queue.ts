import { Queue, type JobsOptions } from 'bullmq';
import { Redis as IORedis } from 'ioredis';

export interface NotificationDispatchInput {
  tenantId: string;
  agentId: string;
  type: string;
  title: string;
  body: string;
  clickUrl?: string;
}

let notificationQueue: Queue<NotificationDispatchInput> | null = null;

function getNotificationQueue(): Queue<NotificationDispatchInput> {
  if (!notificationQueue) {
    notificationQueue = new Queue<NotificationDispatchInput>('notification', {
      connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      // job id 由事件 id 組成：完成的 job 保留 24 小時，事件重送時 BullMQ 不建立第二個 job（design 決策 10）。
      // 寫入通知失敗時重試；通知是至少一次，重試可能產生重複的通知（standalone-worker-runtime）
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return notificationQueue;
}

export async function enqueueNotification(input: NotificationDispatchInput, opts?: JobsOptions): Promise<void> {
  await getNotificationQueue().add('notification:dispatch', input, opts);
}

export async function closeNotificationQueue(): Promise<void> {
  if (!notificationQueue) return;
  await notificationQueue.close();
  notificationQueue = null;
}
