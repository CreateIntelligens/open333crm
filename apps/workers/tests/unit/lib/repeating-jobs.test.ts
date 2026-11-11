import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { Queue } from 'bullmq';
import { REPEATING_JOBS, registerRepeatingJobs } from '#src/lib/repeating-jobs';

/**
 * 週期 job 的重新註冊（queue-monitoring「各佇列 job 的保留期限」，Scenario「部署前已排定的週期 job」）。
 * 舊的 repeatable job 會延續註冊時的選項，所以先刪除，再以帶保留期限的選項註冊。
 */

type Call =
  | { op: 'remove'; queue: string; key: string }
  | { op: 'add'; queue: string; name: string; opts: Record<string, unknown> };

function makeQueueFactory(calls: Call[]) {
  return (name: string) =>
    ({
      async getRepeatableJobs() {
        return [{ key: `${name}:old-key` }];
      },
      async removeRepeatableByKey(key: string) {
        calls.push({ op: 'remove', queue: name, key });
        return true;
      },
      async add(jobName: string, _data: unknown, opts: Record<string, unknown>) {
        calls.push({ op: 'add', queue: name, name: jobName, opts });
      },
    }) as unknown as Queue;
}

test('部署前已排定的週期 job', async () => {
  const calls: Call[] = [];
  await registerRepeatingJobs(makeQueueFactory(calls));

  for (const job of REPEATING_JOBS) {
    const ofQueue = calls.filter((c) => c.queue === job.queue);
    assert.deepEqual(
      ofQueue.map((c) => c.op),
      ['remove', 'add'],
      `${job.queue}：先刪除舊的 repeatable job，再註冊`,
    );
    const remove = ofQueue[0] as Extract<Call, { op: 'remove' }>;
    assert.equal(remove.key, `${job.queue}:old-key`);
    const add = ofQueue[1] as Extract<Call, { op: 'add' }>;
    assert.equal(add.name, job.name);
    assert.equal(add.opts.jobId, job.name);
    assert.deepEqual(add.opts.repeat, { every: job.every });
    assert.deepEqual(add.opts.removeOnComplete, { age: 86_400 });
    assert.deepEqual(add.opts.removeOnFail, { age: 604_800 });
  }
  assert.deepEqual(
    REPEATING_JOBS.map((j) => j.queue),
    ['sla', 'data-export-cleanup', 'tag-expiry-cleanup', 'agent-retention-cleanup'],
  );
});
