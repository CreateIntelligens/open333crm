import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
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

  await publishSocketEvent(redisPublisher, `agent:${agentId}`, 'notification.new', notification);

  logger.info(`[notification] Dispatched notification ${notification.id} to agent ${agentId}`);
}
