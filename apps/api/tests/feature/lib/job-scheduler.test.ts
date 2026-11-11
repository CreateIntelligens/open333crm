/**
 * Job Scheduler 在多個 API 實例下的行為（refactor/schedulers-bullmq）。連 feature 測試的 Redis。
 * 每個測試用自己的 Queue 名稱，結束時刪掉這個 Queue 的所有資料。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterEach, test } from 'vitest';
import { createBullJobScheduler, type JobScheduler } from '#src/lib/job-scheduler.js';

const redisUrl = process.env.REDIS_URL!;
const opened: JobScheduler[] = [];
const queueNames: string[] = [];

function newQueueName(): string {
  const name = `test-api-scheduler-${randomUUID()}`;
  queueNames.push(name);
  return name;
}

function instance(queueName: string): JobScheduler {
  const scheduler = createBullJobScheduler(redisUrl, queueName);
  opened.push(scheduler);
  return scheduler;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('等待逾時');
    await new Promise((r) => setTimeout(r, 50));
  }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
  for (const name of queueNames.splice(0)) {
    const queue = new Queue(name, { connection: { url: redisUrl } });
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test('兩個實例註冊同一個排程：Redis 裡只有一個排程、一筆待執行的 job', async () => {
  const queueName = newQueueName();
  const noop = async () => {};
  instance(queueName).registerSchedule({ id: 'dup', every: 60_000, run: noop });
  instance(queueName).registerSchedule({ id: 'dup', every: 60_000, run: noop });

  const queue = new Queue(queueName, { connection: { url: redisUrl } });
  try {
    await waitFor(async () => (await queue.getJobSchedulersCount()) > 0);
    // 第二個實例的註冊也要處理完，才比較 job 數
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await queue.getJobSchedulersCount(), 1);
    assert.equal(await queue.getJobCountByTypes('waiting', 'delayed', 'prioritized'), 1);
  } finally {
    await queue.close();
  }
});

test('withoutOverlapping：兩個實例、run 比週期久時，run 不會同時執行', async () => {
  const queueName = newQueueName();
  let running = 0;
  let maxRunning = 0;
  let runs = 0;
  const def = {
    id: 'slow',
    every: 200,
    withoutOverlapping: { expiresInMs: 10_000 },
    run: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 1000));
      running--;
      runs++;
    },
  };
  // 兩個實例各有一個 Worker：沒有鎖時，第二個 Worker 會在第一期還沒跑完時取走下一期
  const a = instance(queueName);
  const b = instance(queueName);
  a.registerSchedule(def);
  b.registerSchedule(def);
  a.start();
  b.start();

  await waitFor(async () => runs >= 2, 8000);
  assert.equal(maxRunning, 1);
});
