import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { logger } from '@open333crm/core';
import { publishSocketEvent } from '../lib/socket-bridge.js';

interface NotificationJobData {
  tenantId: string;
  agentId: string;
  type: string;
  title: string;
  body: string;
  clickUrl?: string;
}

export async function handleNotificationJob(
  job: Job,
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  const { tenantId, agentId, type, title, body, clickUrl } =
    job.data as NotificationJobData;

  const notification = await prisma.notification.create({
    data: {
      tenantId,
      agentId,
      type,
      title,
      body,
      clickUrl: clickUrl ?? null,
    },
  });

  // 通知已寫入；推播是最多一次、可以遺失的副作用，失敗時只記 log，job 照常完成
  try {
    await publishSocketEvent(redisPublisher, `agent:${agentId}`, 'notification.new', notification);
  } catch (err) {
    logger.error(`[notification] Failed to push notification ${notification.id} to agent ${agentId}: ${String(err)}`);
  }

  logger.info(`[notification] Dispatched notification ${notification.id} to agent ${agentId}`);
}
