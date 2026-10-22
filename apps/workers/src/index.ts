import './load-env.js';
import { Worker, Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { createWorkerPluginRegistry } from './lib/plugin-registry.js';
import { handleSlaPoll } from './handlers/sla.handler.js';
// Broadcast 排程改由 apps/api 端負責（含完整 executeBroadcast 邏輯：變數替換 / multicast / recipient 記錄）。
// Worker 端不再 polling broadcasts 避免雙發 race。
import { handleNotificationJob } from './handlers/notification.handler.js';
import { handleAutomationJob } from './handlers/automation.handler.js';
import { handleRichMenuBindJob } from './handlers/rich-menu-bind.handler.js';
import { handleDataErasureJob } from './handlers/data-erasure.handler.js';
import {
  handleDataExportJob,
  handleDataExportCleanup,
} from './handlers/data-export.handler.js';
import { closeNotificationQueue } from './lib/notification-queue.js';
import { registerRepeatingJobs } from './lib/repeating-jobs.js';
import { handleAgentRetentionCleanup } from './handlers/agent-retention.handler.js';
import { handleTagExpiryCleanup } from './handlers/tag-expiry.handler.js';

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
  const databaseAdminUrl = process.env.DATABASE_URL_ADMIN;
  if (!databaseAdminUrl) {
    throw new Error('DATABASE_URL_ADMIN is required for cross-tenant workers');
  }
  const prisma = new PrismaClient({
    datasources: {
      // Retention and other standalone workers are cross-tenant infrastructure.
      // Require the explicit BYPASSRLS connection so forced RLS cannot silently
      // turn cleanup and scheduler jobs into no-ops.
      db: { url: databaseAdminUrl },
    },
  });

  // Redis connections: one for BullMQ workers, one for pub/sub publishing
  const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const redisPublisher = new IORedis(process.env.REDIS_URL!);

  // ── Channel plugin registry ──────────────────────────────────────────────────
  const pluginRegistry = createWorkerPluginRegistry();

  logger.info('Workers starting...');

  // ── Queues (register repeating jobs) ──────────────────────────────────────────
  const repeatingQueues = await registerRepeatingJobs((name) => new Queue(name, { connection }));

  // 順手清掉舊的 broadcast repeatable job（如果之前 worker 跑過、Redis 仍有殘留）
  const legacyBroadcastQueue = new Queue('broadcast', { connection });
  try {
    const repeatables = await legacyBroadcastQueue.getRepeatableJobs();
    for (const r of repeatables) {
      await legacyBroadcastQueue.removeRepeatableByKey(r.key);
    }
    await legacyBroadcastQueue.close();
  } catch (err) {
    logger.warn('[broadcast] Cleanup of legacy queue failed (safe to ignore)', { err });
  }

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
      await handleAutomationJob(job, prisma, redisPublisher, pluginRegistry);
    },
    { connection },
  );

  const richMenuBindWorker = new Worker(
    'rich-menu-bind',
    async (job) => {
      logger.info(`[rich-menu-bind] Processing job ${job.id}: ${job.name}`);
      await handleRichMenuBindJob(job, prisma, pluginRegistry);
    },
    { connection },
  );

  const dataErasureWorker = new Worker(
    'data-erasure',
    async (job) => {
      logger.info(`[data-erasure] Processing job ${job.id}: ${job.name}`);
      await handleDataErasureJob(job, prisma, redisPublisher);
    },
    { connection },
  );

  const dataExportWorker = new Worker(
    'data-export',
    async (job) => {
      logger.info(`[data-export] Processing job ${job.id}: ${job.name}`);
      await handleDataExportJob(job, prisma, redisPublisher);
    },
    { connection },
  );

  const dataExportCleanupWorker = new Worker(
    'data-export-cleanup',
    async (job) => {
      logger.info(`[data-export-cleanup] Processing job ${job.id}: ${job.name}`);
      try {
        await handleDataExportCleanup(prisma);
      } catch (err) {
        logger.error('[data-export-cleanup] Cleanup failed', { err });
      }
    },
    { connection },
  );

  const tagExpiryWorker = new Worker(
    'tag-expiry-cleanup',
    async (job) => {
      logger.info(`[tag-expiry-cleanup] Processing job ${job.id}: ${job.name}`);
      try {
        await handleTagExpiryCleanup(prisma);
      } catch (err) {
        logger.error('[tag-expiry-cleanup] Cleanup failed', { err });
      }
    },
    { connection },
  );

  const agentRetentionWorker = new Worker(
    'agent-retention-cleanup',
    async (job) => {
      logger.info(`[agent-retention-cleanup] Processing job ${job.id}: ${job.name}`);
      try {
        await handleAgentRetentionCleanup(prisma);
      } catch (err) {
        logger.error('[agent-retention-cleanup] Cleanup failed', { err });
      }
    },
    { connection },
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────────────
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      slaWorker.close(),
      tagExpiryWorker.close(),
      notificationWorker.close(),
      automationWorker.close(),
      richMenuBindWorker.close(),
      dataErasureWorker.close(),
      dataExportWorker.close(),
      dataExportCleanupWorker.close(),
      agentRetentionWorker.close(),
    ]);
    await Promise.all(repeatingQueues.map((queue) => queue.close()));
    await closeNotificationQueue();
    await prisma.$disconnect();
    connection.disconnect();
    redisPublisher.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info(
    'Workers ready: sla (repeating), notification, automation, data-erasure, data-export, data-export-cleanup (repeating), agent-retention-cleanup (repeating)',
  );
}

main().catch((err) => {
  logger.error('Workers failed to start', err);
  process.exit(1);
});
