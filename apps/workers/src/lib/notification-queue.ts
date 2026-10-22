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
      // job id 由事件 id 組成：完成的 job 保留 24 小時，事件重送時 BullMQ 不建立第二個 job（design 決策 10）
      defaultJobOptions: { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } },
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
