import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { EmailCapacityError, UncertainEmailDeliveryError } from '#src/modules/email/email.service.js';
import {
  createEmailDispatchProcessor,
  enqueueEmailBatch,
  type EmailDispatchJobData,
} from '#src/modules/email/email-queue.js';
import { handleCanvasSendMessage } from '#src/modules/canvas/canvas.worker.js';

test('Enqueueing a 5000-email batch chunks and staggers delivery', async () => {
  const batches: Array<Array<{ name: string; data: EmailDispatchJobData; opts?: { delay?: number; jobId?: string } }>> = [];
  const inputs = Array.from({ length: 5_000 }, (_, i) => ({
    to: `user-${i}@example.com`,
    subject: `Campaign #${i}`,
    html: `<p>Hi ${i}</p>`,
  }));

  const summary = await enqueueEmailBatch(
    inputs,
    { batchSize: 100, ratePerSec: 8, jobIdPrefix: 'bulk-5k' },
    {
      queue: {
        add: async () => ({}),
        addBulk: async (jobs) => {
          batches.push(jobs);
          return [];
        },
      },
    },
  );

  assert.equal(summary.total, 5_000);
  assert.equal(summary.batches, 50);
  assert.equal(summary.estimatedSeconds, 625);
  assert.equal(batches.length, 50);
  assert.ok(batches.every((chunk) => chunk.length === 100));
  assert.equal(batches[0]![0]!.opts?.delay, 0);
  assert.equal(batches[0]![7]!.opts?.delay, 0);
  assert.equal(batches[0]![8]!.opts?.delay, 1_000);
  assert.equal(batches[0]![0]!.data.idempotencyKey, 'bulk-5k__0');
  assert.equal(batches[0]![0]!.data.priority, 'bulk');
  assert.equal(batches[0]![0]!.opts?.jobId, 'bulk-5k__0');
  assert.equal(batches[49]![99]!.opts?.delay, Math.floor(4_999 / 8) * 1_000);
  const empty = await enqueueEmailBatch([], { batchSize: 100, ratePerSec: 8 });
  assert.deepEqual(empty, { total: 0, batches: 0, estimatedSeconds: 0 });
});

test('Queued email job reschedules on capacity or throttling error without burning retries', async () => {
  const delayedCalls: Array<{ timestamp: number; token?: string }> = [];
  const processor = createEmailDispatchProcessor(async () => {
    throw new EmailCapacityError('rate_limited', 400);
  });

  const before = Date.now();
  await assert.rejects(
    processor(
      {
        data: { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' },
        moveToDelayed: async (timestamp: number, token?: string) => {
          delayedCalls.push({ timestamp, token });
        },
      } as unknown as Job<EmailDispatchJobData>,
      'lock-token-1',
    ),
    (err: unknown) => err instanceof DelayedError,
  );
  assert.equal(delayedCalls.length, 1);
  assert.ok(delayedCalls[0]!.timestamp >= before + 400);
  assert.equal(delayedCalls[0]!.token, 'lock-token-1');

  const failing = createEmailDispatchProcessor(async () => {
    throw new Error('permanent failure');
  });
  await assert.rejects(
    failing({
      data: { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' },
      moveToDelayed: async () => {
        throw new Error('must not delay');
      },
    } as unknown as Job<EmailDispatchJobData>),
    /permanent failure/,
  );

  const uncertain = createEmailDispatchProcessor(async () => {
    throw new UncertainEmailDeliveryError(new Error('socket lost after DATA'));
  });
  await assert.rejects(
    uncertain({
      data: { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' },
      moveToDelayed: async () => {
        throw new Error('must not delay');
      },
    } as unknown as Job<EmailDispatchJobData>),
    (err: unknown) => err instanceof UnrecoverableError,
  );
});

test('Canvas email node routes through enqueueEmail when provided', async () => {
  const enqueued: Array<{ to: string; subject: string; html: string; priority?: string }> = [];
  const prisma = {
    contact: { findFirst: async () => ({ email: 'fan@example.com' }) },
    templateView: { findFirst: async () => ({ id: 'tv-1', body: [{ type: 'text', text: 'Hello {{name}}' }] }) },
    messageTemplate: { findUnique: async () => ({ name: 'Welcome', description: 'Welcome text' }) },
  };
  await handleCanvasSendMessage(
    prisma as never,
    { to: () => ({ emit: () => {} }) },
    'tenant-1',
    { executionId: 'exec-1', contactId: 'c-1', channelType: 'email', templateId: 'tpl-1', vars: { name: 'Alice' } },
    {
      enqueueEmail: async (input) => {
        enqueued.push(input);
      },
    },
  );
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]!.to, 'fan@example.com');
  assert.equal(enqueued[0]!.subject, 'Welcome');
  assert.equal(enqueued[0]!.priority, 'bulk');

  await assert.rejects(
    handleCanvasSendMessage(
      prisma as never,
      { to: () => ({ emit: () => {} }) },
      'tenant-1',
      { executionId: 'exec-1', contactId: 'c-1', channelType: 'email', templateId: 'tpl-1', vars: { name: 'Alice' } },
      { enqueueEmail: async () => { throw new Error('redis down'); } },
    ),
    /redis down/,
  );
});
