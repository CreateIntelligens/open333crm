import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { isNotifiableAgent, logger } from '@open333crm/core';
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

  // 排隊期間收件成員可能已被永久刪除（寫入會撞外鍵、重試也不會成功）或已停用：略過，job 正常完成（#484）
  if (!(await isNotifiableAgent(prisma, tenantId, agentId))) {
    logger.info(`[notification] 略過通知 ${type}：收件成員 ${agentId} 已不存在或已停用（tenant ${tenantId}）`);
    return;
  }

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
