import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { linePlugin, fbPlugin } from '@open333crm/channel-plugins';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { handleSlaPoll } from './handlers/sla.handler.js';
import { handleBroadcastPoll } from './handlers/broadcast.handler.js';
import { handleNotificationJob } from './handlers/notification.handler.js';
import { handleAutomationJob } from './handlers/automation.handler.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

async function main() {
  const prisma = new PrismaClient();

  // Redis connections: one for BullMQ workers, one for pub/sub publishing
  const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const redisPublisher = new IORedis(process.env.REDIS_URL!);

  // ── Channel plugin registry ──────────────────────────────────────────────────
  const pluginRegistry = new Map<string, ChannelPlugin>();

  pluginRegistry.set(linePlugin.channelType, linePlugin);
  pluginRegistry.set(fbPlugin.channelType, fbPlugin);

  logger.info('Workers starting...');

  // ── Queues (register repeating jobs) ──────────────────────────────────────────
  const slaQueue = new Queue('sla', { connection });
  const broadcastQueue = new Queue('broadcast', { connection });

  await slaQueue.add('sla:poll', {}, { repeat: { every: 60_000 }, jobId: 'sla:poll' });
  await broadcastQueue.add('broadcast:poll', {}, { repeat: { every: 60_000 }, jobId: 'broadcast:poll' });

  // ── Workers ────────────────────────────────────────────────────────────────────

  const slaWorker = new Worker(
    'sla',
    async (job) => {
      logger.info(`[sla] Processing job ${job.id}: ${job.name}`);
      try {
        await handleSlaPoll(prisma, redisPublisher);
      } catch (err) {
        logger.error('[sla] Poll failed', { err });
      }
    },
    { connection },
  );

  const broadcastWorker = new Worker(
    'broadcast',
    async (job) => {
      logger.info(`[broadcast] Processing job ${job.id}: ${job.name}`);
      try {
        await handleBroadcastPoll(prisma, (type) => pluginRegistry.get(type));
      } catch (err) {
        logger.error('[broadcast] Poll failed', { err });
      }
    },
    { connection },
  );

  const notificationWorker = new Worker(
    'notification',
    async (job) => {
      logger.info(`[notification] Processing job ${job.id}: ${job.name}`);
      await handleNotificationJob(job, prisma, redisPublisher);
    },
    { connection },
  );

  const automationWorker = new Worker(
    'automation',
    async (job) => {
      logger.info(`[automation] Processing job ${job.id}: ${job.name}`);
      await handleAutomationJob(job, prisma, redisPublisher);
    },
    { connection },
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────────────
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      slaWorker.close(),
      broadcastWorker.close(),
      notificationWorker.close(),
      automationWorker.close(),
    ]);
    await slaQueue.close();
    await broadcastQueue.close();
    await prisma.$disconnect();
    connection.disconnect();
    redisPublisher.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Workers ready: sla (repeating), broadcast (repeating), notification, automation');
}

main().catch((err) => {
  console.error('Workers failed to start', err);
  process.exit(1);
});
