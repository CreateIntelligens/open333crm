import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, test } from 'vitest';
import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { createEmailDispatchProcessor, enqueueEmailBatch } from '#src/modules/email/email-queue.js';
import { EmailCapacityError, EmailFailoverCoordinator } from '#src/modules/email/email-failover.js';

const prefix = `{test:email-failover:${randomUUID()}}`;
const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
const opts = { prefix, smtpMaxConcurrency: 3, smtpRatePerSec: 10, smtpBulkRatePerSec: 8, resendMaxConcurrency: 5, resendRatePerSec: 10 };
const first = new EmailFailoverCoordinator(redis, opts);
const second = new EmailFailoverCoordinator(redis, opts);

const allKeys = [
  `${prefix}:open`,
  `${prefix}:probe`,
  `${prefix}:smtp`,
  `${prefix}:resend`,
  `${prefix}:smtp-rate`,
  `${prefix}:resend-rate`,
  `${prefix}:smtp-bulk-rate`,
];

beforeEach(async () => {
  await redis.del(...allKeys);
});

afterAll(async () => {
  await redis.del(...allKeys);
  await redis.quit();
});

test('Concurrent requests during SMTP outage and cooldown expiry', async () => {
  const smtp = await Promise.all([first.acquire(), second.acquire(), first.acquire()]);
  assert.ok(smtp.every((lease) => lease.provider === 'smtp'));
  await assert.rejects(second.acquire(), /capacity/);
  await Promise.all(smtp.slice(1).map((lease) => first.finish(lease, 'success')));
  await first.finish(smtp[0]!, 'fail');

  const fallback = await Promise.all(Array.from({ length: 5 }, () => second.acquire()));
  assert.ok(fallback.every((lease) => lease.provider === 'resend'));
  await assert.rejects(first.acquire(), /capacity/);
  await Promise.all(fallback.map((lease) => second.finish(lease, 'success')));

  await redis.set(`${prefix}:open`, '1');
  const recovery = await Promise.all([first.acquire(), second.acquire(), first.acquire()]);
  const probes = recovery.filter((lease) => lease.provider === 'probe');
  assert.equal(probes.length, 1);
  await Promise.all(recovery.filter((lease) => lease.provider === 'resend').map((lease) => second.finish(lease, 'success')));
  await first.finish(probes[0]!, 'success');
  const restored = await second.acquire();
  assert.equal(restored.provider, 'smtp');
  await second.finish(restored, 'success');
});

test('Expired leases after a process stops do not block recovery', async () => {
  const abandoned = await first.acquire();
  await redis.zadd(`${prefix}:smtp`, 1, abandoned.token);
  const replacement = await Promise.all([second.acquire(), second.acquire(), second.acquire()]);
  assert.ok(replacement.every((lease) => lease.provider === 'smtp'));
  await Promise.all(replacement.map((lease) => second.finish(lease, 'success')));
  await first.finish(abandoned, 'success');
});

test('Bulk rate cap reserves headroom for transactional emails and throttling keeps circuit closed', async () => {
  const capped = new EmailFailoverCoordinator(redis, {
    prefix,
    smtpMaxConcurrency: 10,
    smtpRatePerSec: 4,
    smtpBulkRatePerSec: 2,
    resendMaxConcurrency: 5,
    resendRatePerSec: 1,
  });

  const b1 = await capped.acquire('bulk');
  const b2 = await capped.acquire('bulk');
  await assert.rejects(
    capped.acquire('bulk'),
    (err: unknown) => err instanceof EmailCapacityError && err.reason === 'rate_limited' && err.retryAfterMs >= 50,
  );

  // Transactional headroom (remaining 2/s) still succeeds while bulk is capped
  const t1 = await capped.acquire('transactional');
  const t2 = await capped.acquire('transactional');
  await assert.rejects(
    capped.acquire('transactional'),
    (err: unknown) => err instanceof EmailCapacityError && err.reason === 'rate_limited',
  );

  // Throttled release keeps SMTP circuit closed
  await capped.finish(b1, 'throttled');
  await Promise.all([b2, t1, t2].map((l) => capped.finish(l, 'success')));
  assert.equal(await redis.get(`${prefix}:open`), null);

  // Failover respects Resend per-second rate cap
  const probe = await capped.acquire('transactional');
  await capped.finish(probe, 'fail');
  const r1 = await capped.acquire('bulk');
  assert.equal(r1.provider, 'resend');
  await assert.rejects(
    capped.acquire('bulk'),
    (err: unknown) => err instanceof EmailCapacityError && err.reason === 'rate_limited',
  );
  await capped.finish(r1, 'success');

  // Bulk concurrency leaves at least 1 SMTP slot for transactional when maxConcurrency >= 2
  const concCapped = new EmailFailoverCoordinator(redis, {
    prefix: `${prefix}-conc`,
    smtpMaxConcurrency: 2,
    smtpRatePerSec: 10,
    smtpBulkRatePerSec: 8,
  });
  const bulkHeld = await concCapped.acquire('bulk');
  await assert.rejects(
    concCapped.acquire('bulk'),
    (err: unknown) => err instanceof EmailCapacityError && err.reason === 'busy',
  );
  const txSlot = await concCapped.acquire('transactional');
  assert.equal(txSlot.provider, 'smtp');
  await Promise.all([concCapped.finish(bulkHeld, 'success'), concCapped.finish(txSlot, 'success')]);
  await redis.del(`{${prefix}-conc}:open`, `{${prefix}-conc}:probe`, `{${prefix}-conc}:smtp`, `{${prefix}-conc}:resend`, `{${prefix}-conc}:smtp-rate`, `{${prefix}-conc}:resend-rate`, `{${prefix}-conc}:smtp-bulk-rate`);
});

test('BullMQ batch worker paces through EmailCapacityError without burning attempts', async () => {
  const queueName = `test-email-dispatch-${randomUUID()}`;
  const queue = new Queue(queueName, {
    connection: { url: process.env.REDIS_URL! },
    defaultJobOptions: { attempts: 2, removeOnComplete: true, removeOnFail: true },
  });
  const capped = new EmailFailoverCoordinator(redis, {
    prefix: `{${queueName}}`,
    smtpMaxConcurrency: 2,
    smtpRatePerSec: 3,
    smtpBulkRatePerSec: 2,
  });

  const delivered: string[] = [];
  const allDone = Promise.withResolvers<void>();
  const processor = createEmailDispatchProcessor(async (input) => {
    const lease = await capped.acquire(input.priority ?? 'bulk');
    try {
      delivered.push(input.to);
      if (delivered.length === 5) allDone.resolve();
    } finally {
      await capped.finish(lease, 'success');
    }
  });

  const worker = new Worker(queueName, processor, {
    connection: { url: process.env.REDIS_URL! },
    concurrency: 5,
  });

  try {
    const batch = Array.from({ length: 5 }, (_, i) => ({
      to: `fan-${i}@example.com`,
      subject: 'Batch test',
      html: '<p>Hello</p>',
    }));
    await enqueueEmailBatch(batch, { batchSize: 2, ratePerSec: 2 }, { queue });

    await allDone.promise;
    assert.equal(delivered.length, 5);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.del(
      `{${queueName}}:open`,
      `{${queueName}}:probe`,
      `{${queueName}}:smtp`,
      `{${queueName}}:resend`,
      `{${queueName}}:smtp-rate`,
      `{${queueName}}:resend-rate`,
      `{${queueName}}:smtp-bulk-rate`,
    );
  }
});
