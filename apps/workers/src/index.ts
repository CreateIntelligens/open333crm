import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

// Load env BEFORE any module that reads process.env at import time (e.g. BullMQ
// queues constructed with `connection: { url: process.env.REDIS_URL }`).
// Walk up from cwd until we find the monorepo root .env (covers both dev
// where cwd=apps/workers and prod where it might be the package dir).
function loadEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config(); // fall back to default (cwd/.env)
}
loadEnv();

import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { linePlugin, fbPlugin } from '@open333crm/channel-plugins';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
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

  await slaQueue.add('sla:poll', {}, { repeat: { every: 300_000 }, jobId: 'sla:poll' });

  // 資料匯出保留期清理：每小時掃一次，把到期的 completed 轉 expired 並刪 MinIO 物件
  const dataExportCleanupQueue = new Queue('data-export-cleanup', { connection });
  await dataExportCleanupQueue.add(
    'data-export:cleanup',
    {},
    { repeat: { every: 3_600_000 }, jobId: 'data-export:cleanup' },
  );

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

  // ── Graceful shutdown ──────────────────────────────────────────────────────────
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      slaWorker.close(),
      notificationWorker.close(),
      automationWorker.close(),
      richMenuBindWorker.close(),
      dataErasureWorker.close(),
      dataExportWorker.close(),
      dataExportCleanupWorker.close(),
    ]);
    await slaQueue.close();
    await dataExportCleanupQueue.close();
    await closeNotificationQueue();
    await prisma.$disconnect();
    connection.disconnect();
    redisPublisher.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info(
    'Workers ready: sla (repeating), notification, automation, data-erasure, data-export, data-export-cleanup (repeating)',
  );
}

main().catch((err) => {
  logger.error('Workers failed to start', err);
  process.exit(1);
});
