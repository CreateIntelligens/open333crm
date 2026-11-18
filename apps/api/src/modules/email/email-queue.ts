import { randomUUID } from 'node:crypto';
import { DelayedError, Queue, UnrecoverableError, type Job, type JobsOptions } from 'bullmq';
import { EMAIL_DISPATCH_QUEUE } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { resolveEffectiveBulkRate } from './email-failover.js';
import { EmailCapacityError, UncertainEmailDeliveryError, sendEmail, type SendEmailInput } from './email.service.js';

export type EmailDispatchJobData = SendEmailInput;

export interface EmailDispatchQueueSink {
  add(name: string, data: EmailDispatchJobData, opts?: JobsOptions): Promise<unknown>;
  addBulk(jobs: Array<{ name: string; data: EmailDispatchJobData; opts?: JobsOptions }>): Promise<unknown>;
}

export interface EmailBatchOptions {
  batchSize?: number;
  ratePerSec?: number;
  jobIdPrefix?: string;
}

export interface EmailBatchResult {
  total: number;
  batches: number;
  estimatedSeconds: number;
}

let _emailDispatchQueue: Queue<EmailDispatchJobData> | null = null;

function emailDispatchQueue(): Queue<EmailDispatchJobData> {
  if (!_emailDispatchQueue) {
    _emailDispatchQueue = new Queue<EmailDispatchJobData>(EMAIL_DISPATCH_QUEUE, {
      connection: { url: process.env.REDIS_URL! },
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return _emailDispatchQueue;
}

export async function closeEmailDispatchQueue(): Promise<void> {
  if (!_emailDispatchQueue) return;
  await _emailDispatchQueue.close();
  _emailDispatchQueue = null;
}

export async function enqueueEmail(
  input: SendEmailInput,
  deps?: { queue?: Pick<EmailDispatchQueueSink, 'add'> },
): Promise<void> {
  const queue = deps?.queue ?? emailDispatchQueue();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  await queue.add('email:dispatch', { ...input, priority: input.priority ?? 'bulk', idempotencyKey });
}

export async function enqueueEmailBatch(
  inputs: SendEmailInput[],
  opts: EmailBatchOptions = {},
  deps?: { queue?: EmailDispatchQueueSink },
): Promise<EmailBatchResult> {
  if (inputs.length === 0) {
    return { total: 0, batches: 0, estimatedSeconds: 0 };
  }

  const batchSize = opts.batchSize ?? getConfig().EMAIL_BATCH_SIZE;
  const ratePerSec = opts.ratePerSec ?? (() => {
    const cfg = getConfig();
    return resolveEffectiveBulkRate(cfg.EMAIL_SMTP_RATE_PER_SEC, cfg.EMAIL_SMTP_BULK_RATE_PER_SEC);
  })();
  const queue = deps?.queue ?? emailDispatchQueue();
  let batches = 0;

  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const chunk = inputs.slice(offset, offset + batchSize);
    const jobs = chunk.map((item, idx) => {
      const globalIndex = offset + idx;
      const delayMs = Math.floor(globalIndex / ratePerSec) * 1000;
      const jobId = opts.jobIdPrefix ? `${opts.jobIdPrefix}__${globalIndex}` : undefined;
      const jobOpts: JobsOptions = {
        delay: delayMs,
        ...(jobId ? { jobId } : {}),
      };
      return {
        name: 'email:dispatch',
        data: {
          ...item,
          priority: item.priority ?? 'bulk',
          idempotencyKey: item.idempotencyKey ?? jobId ?? randomUUID(),
        },
        opts: jobOpts,
      };
    });
    await queue.addBulk(jobs);
    batches++;
  }

  return {
    total: inputs.length,
    batches,
    estimatedSeconds: Math.ceil(inputs.length / ratePerSec),
  };
}

export function createEmailDispatchProcessor(
  sendFn: (input: SendEmailInput) => Promise<void> = sendEmail,
) {
  return async (job: Job<EmailDispatchJobData>, token?: string): Promise<void> => {
    try {
      await sendFn({ ...job.data, priority: job.data.priority ?? 'bulk' });
    } catch (error) {
      if (error instanceof UncertainEmailDeliveryError) {
        throw new UnrecoverableError(error.message);
      }
      if (error instanceof EmailCapacityError) {
        const jitter = Math.floor(Math.random() * 150);
        await job.moveToDelayed(Date.now() + error.retryAfterMs + jitter, token);
        throw new DelayedError();
      }
      throw error;
    }
  };
}
