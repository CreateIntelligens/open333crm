/**
 * Flow Wait Node Scheduler (Task 3.2)
 * Schedules FlowExecution resume using BullMQ (falls back to DB polling).
 */

import type { Prisma } from '@prisma/client';
import { logger } from '../logger/index.js';
import { claimOne } from '../db/db-invariants.js';

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

/** 跨租戶掃描到期 execution 用的執行器（API 傳 prismaAdmin，排程在 prismaAdmin 白名單內） */
export type ResumeScanDb = Pick<Prisma.TransactionClient, 'flowExecution'>;
/** 認領用的執行器：withTenant 給的 tx */
export type ResumeClaimDb = Pick<Prisma.TransactionClient, 'flowExecution'>;

export interface ResumeQueueDeps {
  admin: ResumeScanDb;
  /** 在綁定租戶的交易內執行 fn；API 傳 `(tenantId, fn) => withTenant(app.prisma, tenantId, fn)` */
  inTenant: <T>(tenantId: string, fn: (tx: ResumeClaimDb) => Promise<T>) => Promise<T>;
  /** 認領成功之後恢復執行；預設以 resumeFromWait 交給 FlowRunner，測試可替換 */
  resumeFlow?: (executionId: string) => Promise<void>;
  now?: Date;
}

const RESUME_BATCH_SIZE = 50;

async function loadDefaultResumeFlow(): Promise<(executionId: string) => Promise<void>> {
  const { FlowRunner } = await import('./flow-runner.js');
  return (executionId) => FlowRunner.run(executionId, { resumeFromWait: true });
}

/** 查出 resumeAt 已到期的 WAITING execution，最多 RESUME_BATCH_SIZE 筆 */
export function findDueWaitingExecutions(db: ResumeScanDb, now: Date) {
  return db.flowExecution.findMany({
    where: { status: 'WAITING', resumeAt: { lte: now } },
    select: { id: true, tenantId: true },
    orderBy: { resumeAt: 'asc' },
    take: RESUME_BATCH_SIZE,
  });
}

/**
 * 以條件更新認領一筆到期的 WAITING execution，改成 RUNNING 並清掉 resumeAt。
 * 回傳 true 代表這次認領成功；false 代表已被另一次喚醒認領、已不是 WAITING，或 resumeAt 改到未來。
 * 兩個交易同時認領同一筆時，後到的等前一個 commit，再以新的狀態重新判斷條件，所以只有一個成功（issue #334）。
 */
export function claimDueExecution(tx: ResumeClaimDb, tenantId: string, executionId: string, now: Date): Promise<boolean> {
  return claimOne(() =>
    tx.flowExecution.updateMany({
      where: { id: executionId, tenantId, status: 'WAITING', resumeAt: { lte: now } },
      data: { status: 'RUNNING', resumeAt: null },
    }),
  );
}

/**
 * Process all WAITING FlowExecutions whose resumeAt time has passed.
 * API 行程的 canvas-resume 排程每 60 秒呼叫一次。
 *
 * 每筆先在租戶交易內認領，commit 之後才交給 FlowRunner：FlowRunner 用另一條連線讀 execution（AUDIT RLS-01），
 * commit 之前讀不到 RUNNING。認領失敗的不恢復，所以排程重跑或兩期同時執行時，同一個 execution 只恢復一次。
 * 不等 FlowRunner 跑完，與原本相同。
 */
export async function processResumeQueue(deps: ResumeQueueDeps): Promise<void> {
  const now = deps.now ?? new Date();
  // 先載入 FlowRunner（flow-runner.ts 匯入本檔，靜態匯入會循環），迴圈內認領成功就同步開始恢復
  const resumeFlow = deps.resumeFlow ?? (await loadDefaultResumeFlow());

  const due = await findDueWaitingExecutions(deps.admin, now);
  logger.info(`[FlowScheduler] Processing ${due.length} due WAITING executions...`);

  for (const exec of due) {
    let claimed: boolean;
    try {
      claimed = await deps.inTenant(exec.tenantId, (tx) => claimDueExecution(tx, exec.tenantId, exec.id, now));
    } catch (err) {
      logger.error(`[FlowScheduler] 認領 execution ${exec.id} 失敗:`, err);
      continue;
    }
    if (!claimed) {
      logger.info(`[FlowScheduler] Execution ${exec.id} 已被認領或不再等待，略過`);
      continue;
    }

    resumeFlow(exec.id).catch((err) => {
      logger.error(`[FlowScheduler] Error resuming execution ${exec.id}:`, err);
    });
  }
}
