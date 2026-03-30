/**
 * Flow Wait Node Scheduler (Task 3.2)
 * Schedules FlowExecution resume using BullMQ (falls back to DB polling).
 */

import { logger } from '../logger/index.js';

/** Job name used in BullMQ */
export const FLOW_RESUME_JOB = 'flow:resume';

/**
 * Schedule a FlowExecution to resume at a specific time.
 *
 * Strategy:
 * 1. Try BullMQ via dynamic import (requires `@open333crm/core` to have bullmq as a peer dep)
 * 2. Fall back to updating FlowExecution.resumeAt for DB polling
 *
 * The DB already has resumeAt set by FlowRunner before this is called,
 * so the DB fallback requires a periodic poller to pick up WAITING executions.
 */
export async function scheduleWaitNode(executionId: string, resumeAt: Date): Promise<void> {
  const delayMs = Math.max(0, resumeAt.getTime() - Date.now());

  try {
    // Dynamic import — BullMQ may not be available in all environments
    const { Queue } = await import('bullmq').catch(() => ({ Queue: null }));

    if (Queue) {
      // Redis connection config — prefers REDIS_URL, falls back to docker-compose local ports.
      const redisUrl = process.env.REDIS_URL;
      const parsedUrl = redisUrl ? new URL(redisUrl) : null;
      const redisHost = process.env.REDIS_HOST ?? parsedUrl?.hostname ?? 'localhost';
      const redisPort = Number(process.env.REDIS_PORT ?? parsedUrl?.port ?? 6380);

      const queue = new Queue(FLOW_RESUME_JOB, {
        connection: { host: redisHost, port: redisPort },
      });

      await queue.add(
        'resume',
        { executionId },
        { delay: delayMs, jobId: `flow-resume-${executionId}` },
      );

      await queue.close();

      logger.info(
        `[FlowScheduler] Scheduled BullMQ resume for execution ${executionId} in ${delayMs}ms (at ${resumeAt.toISOString()})`,
      );
      return;
    }
  } catch (err) {
    logger.warn(`[FlowScheduler] BullMQ scheduling failed, falling back to DB polling: ${err}`);
  }

  // DB fallback: FlowExecution.resumeAt already set by FlowRunner.
  // A periodic poller (e.g. setupFlowResumePoller) queries for WAITING executions where resumeAt <= now().
  logger.info(
    `[FlowScheduler] DB-polling fallback: execution ${executionId} will resume at ${resumeAt.toISOString()}`,
  );
}

/**
 * Process all WAITING FlowExecutions whose resumeAt time has passed.
 * Call this from a scheduler (cron / setInterval) every ~60 seconds.
 */
export async function processResumeQueue(): Promise<void> {
  const { prisma } = await import('@open333crm/database');
  const { FlowRunner } = await import('./flow-runner.js');

  const due = await prisma.flowExecution.findMany({
    where: {
      status: 'WAITING',
      resumeAt: { lte: new Date() },
    },
    take: 50, // Process in batches
  });

  logger.info(`[FlowScheduler] Processing ${due.length} due WAITING executions...`);

  for (const exec of due) {
    // Mark as RUNNING before handing off to runner to avoid double-processing
    await prisma.flowExecution.update({
      where: { id: exec.id },
      data: { status: 'RUNNING', resumeAt: null },
    });

    FlowRunner.run(exec.id).catch((err) => {
      logger.error(`[FlowScheduler] Error resuming execution ${exec.id}:`, err);
    });
  }
}
