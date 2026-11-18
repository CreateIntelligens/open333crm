/**
 * comment-reply 佇列的 processor（change add-comment-keyword-private-reply design D1、D12、D13）。
 *
 * 只解析 job data、呼叫 deliverCommentReply()，再把結果轉成 BullMQ 的行為：
 * - delay（限流、去重持有者送出中）：job.moveToDelayed() ＋ DelayedError，不消耗重試次數
 * - retry（網路錯誤）：丟錯，BullMQ 依 attempts／backoff 重試
 * - done／gone：正常完成（業務失敗已寫進紀錄，不進 failed set、不發 queue-failed 告警）
 * 資料庫或程式例外直接往外丟：重試用盡後進 failed set，failed-alerts 發 ops-alert。
 *
 * index.ts 與 feature 測試用同一個工廠（createCommentReplyJobRunner），測試不另組一份。
 */
import { DelayedError, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { createRedisRateGate } from './comment-reply-rate-gate.js';
import {
  deliverCommentReply,
  type CommentReplyDeliveryDeps,
  type DeliveryAttempt,
  type DeliveryOutcome,
} from './comment-reply-delivery.flow.js';
import type { CommentReplyJobData } from './comment-reply.types.js';

export type RunCommentReply = (data: CommentReplyJobData, attempt: DeliveryAttempt) => Promise<DeliveryOutcome>;

/** index.ts 與測試共用：以 app_tenant 連線與 Redis 組出執行函式 */
export function createCommentReplyJobRunner(
  deps: { prisma: PrismaClient; redis: Pick<Redis, 'eval' | 'set'> } & Partial<Pick<CommentReplyDeliveryDeps, 'plugins' | 'now' | 'rateGate'>>,
): RunCommentReply {
  const full: CommentReplyDeliveryDeps = {
    prisma: deps.prisma,
    rateGate: deps.rateGate ?? createRedisRateGate(deps.redis),
    ...(deps.plugins ? { plugins: deps.plugins } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  };
  return (data, attempt) => deliverCommentReply(full, data.tenantId, data.logId, attempt);
}

/** 測試或監控用：job 延後的資訊 */
export interface CommentReplyJobLike {
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export function createCommentReplyProcessor(run: RunCommentReply) {
  return async (job: Job | CommentReplyJobLike, token?: string): Promise<unknown> => {
    const { tenantId, logId } = (job.data ?? {}) as Partial<CommentReplyJobData>;
    if (typeof tenantId !== 'string' || typeof logId !== 'string') {
      throw new Error('comment-reply job 缺少 tenantId 或 logId');
    }
    const outcome = await run({ tenantId, logId }, { attemptsMade: job.attemptsMade, attempts: job.opts.attempts ?? 1 });
    if (outcome.kind === 'delay') {
      await job.moveToDelayed(outcome.until, token);
      throw new DelayedError();
    }
    if (outcome.kind === 'retry') throw new Error(outcome.message);
    return outcome;
  };
}
