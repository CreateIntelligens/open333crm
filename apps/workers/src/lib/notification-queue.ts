import { Queue } from 'bullmq';
import IORedis from 'ioredis';

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
    });
  }
  return notificationQueue;
}

export async function enqueueNotification(input: NotificationDispatchInput): Promise<void> {
  await getNotificationQueue().add('notification:dispatch', input);
}

export async function closeNotificationQueue(): Promise<void> {
  if (!notificationQueue) return;
  await notificationQueue.close();
  notificationQueue = null;
}
