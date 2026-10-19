/**
 * API 程序內的定時工作改用 BullMQ Job Scheduler（refactor/schedulers-bullmq）。
 * Queue、Worker 與 Redis 鎖都以 mock 注入，不連 Redis。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createJobScheduler, type JobSchedulerDeps } from '#src/lib/job-scheduler.js';

type Processor = (job: { name: string }) => Promise<void>;

function fakeDeps(opts: { lockFree?: boolean; upsert?: () => Promise<unknown>; existing?: string[] } = {}) {
  const calls = {
    upserts: [] as unknown[][],
    removed: [] as string[],
    lockSets: [] as unknown[][],
    lockEvals: [] as unknown[][],
    workerConcurrency: undefined as number | undefined,
    processor: undefined as Processor | undefined,
    workerClosed: false,
    queueClosed: false,
  };
  const deps: JobSchedulerDeps = {
    queue: {
      upsertJobScheduler: async (...args: unknown[]) => {
        calls.upserts.push(args);
        return opts.upsert ? opts.upsert() : undefined;
      },
      getJobSchedulers: async () => (opts.existing ?? []).map((key) => ({ key })),
      removeJobScheduler: async (id: string) => {
        calls.removed.push(id);
        return true;
      },
      close: async () => {
        calls.queueClosed = true;
      },
    },
    lock: {
      set: async (...args: unknown[]) => {
        calls.lockSets.push(args);
        return opts.lockFree === false ? null : 'OK';
      },
      eval: async (...args: unknown[]) => {
        calls.lockEvals.push(args);
        return 1;
      },
    },
    createWorker: (processor, concurrency) => {
      calls.processor = processor;
      calls.workerConcurrency = concurrency;
      return {
        close: async () => {
          calls.workerClosed = true;
        },
      };
    },
  };
  return { deps, calls };
}

const noop = async () => {};

test('every 排程：以排程 id 註冊 Job Scheduler，job 名稱等於 id', () => {
  const { deps, calls } = fakeDeps();
  createJobScheduler(deps).registerSchedule({ id: 'trial', every: 3_600_000, run: noop });
  assert.deepEqual(calls.upserts, [['trial', { every: 3_600_000 }, { name: 'trial' }]]);
});

test('pattern 排程：以 cron 註冊 Job Scheduler', () => {
  const { deps, calls } = fakeDeps();
  createJobScheduler(deps).registerSchedule({ id: 'analytics', pattern: '0 2 * * *', run: noop });
  assert.deepEqual(calls.upserts, [['analytics', { pattern: '0 2 * * *' }, { name: 'analytics' }]]);
});

test('同一個 id 註冊兩次：丟錯', () => {
  const { deps } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'trial', every: 1000, run: noop });
  assert.throws(() => scheduler.registerSchedule({ id: 'trial', every: 1000, run: noop }), /trial/);
});

test('every 與 pattern 必須剛好設定一個', () => {
  const { deps } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  assert.throws(() => scheduler.registerSchedule({ id: 'none', run: noop }), /none/);
  assert.throws(() => scheduler.registerSchedule({ id: 'both', every: 1000, pattern: '* * * * *', run: noop }), /both/);
});

test('Redis 連不上時註冊不阻塞：upsertJobScheduler 不回應，registerSchedule 仍立刻返回', () => {
  const { deps, calls } = fakeDeps({ upsert: () => new Promise(() => {}) });
  createJobScheduler(deps).registerSchedule({ id: 'trial', every: 1000, run: noop });
  assert.equal(calls.upserts.length, 1);
});

test('註冊失敗不丟出未處理的 rejection', async () => {
  const { deps } = fakeDeps({ upsert: () => Promise.reject(new Error('redis down')) });
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    createJobScheduler(deps).registerSchedule({ id: 'trial', every: 1000, run: noop });
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test('start：建立一個 Worker，concurrency 等於排程數', () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'a', every: 1000, run: noop });
  scheduler.registerSchedule({ id: 'b', every: 1000, run: noop });
  scheduler.registerSchedule({ id: 'c', pattern: '0 2 * * *', run: noop });
  scheduler.start();
  assert.equal(calls.workerConcurrency, 3);
});

test('start 之後再註冊：丟錯', () => {
  const { deps } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'a', every: 1000, run: noop });
  scheduler.start();
  assert.throws(() => scheduler.registerSchedule({ id: 'b', every: 1000, run: noop }), /b/);
});

test('Worker 依 job 名稱呼叫對應的 run', async () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  const ran: string[] = [];
  scheduler.registerSchedule({ id: 'a', every: 1000, run: async () => void ran.push('a') });
  scheduler.registerSchedule({ id: 'b', every: 1000, run: async () => void ran.push('b') });
  scheduler.start();
  await calls.processor!({ name: 'b' });
  assert.deepEqual(ran, ['b']);
});

test('Worker 收到未註冊的 job 名稱：丟錯', async () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'a', every: 1000, run: noop });
  scheduler.start();
  await assert.rejects(calls.processor!({ name: 'removed-job' }), /removed-job/);
});

test('沒有設定 withoutOverlapping：不碰 Redis 鎖', async () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'a', every: 1000, run: noop });
  scheduler.start();
  await calls.processor!({ name: 'a' });
  assert.equal(calls.lockSets.length, 0);
});

test('withoutOverlapping：鎖被別人持有時，不呼叫 run，job 照樣完成', async () => {
  const { deps, calls } = fakeDeps({ lockFree: false });
  const scheduler = createJobScheduler(deps);
  let ran = false;
  scheduler.registerSchedule({
    id: 'canvas-resume',
    every: 60_000,
    withoutOverlapping: { expiresInMs: 600_000 },
    run: async () => {
      ran = true;
    },
  });
  scheduler.start();
  await calls.processor!({ name: 'canvas-resume' });
  assert.equal(ran, false);
  assert.equal(calls.lockEvals.length, 0);
});

test('withoutOverlapping：搶到鎖才執行，存活時間用 expiresInMs，跑完以同一個值釋放', async () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  let ran = false;
  scheduler.registerSchedule({
    id: 'canvas-resume',
    every: 60_000,
    withoutOverlapping: { expiresInMs: 600_000 },
    run: async () => {
      ran = true;
    },
  });
  scheduler.start();
  await calls.processor!({ name: 'canvas-resume' });
  assert.equal(ran, true);
  const [key, value, px, ttl, nx] = calls.lockSets[0];
  assert.deepEqual([key, px, ttl, nx], ['scheduler-lock:canvas-resume', 'PX', 600_000, 'NX']);
  assert.equal(calls.lockEvals.length, 1);
  const evalArgs = calls.lockEvals[0];
  assert.deepEqual(evalArgs.slice(1), [1, 'scheduler-lock:canvas-resume', value]);
});

test('withoutOverlapping：run 丟錯時仍釋放鎖，錯誤往外丟', async () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({
    id: 'canvas-resume',
    every: 60_000,
    withoutOverlapping: { expiresInMs: 600_000 },
    run: async () => {
      throw new Error('boom');
    },
  });
  scheduler.start();
  await assert.rejects(calls.processor!({ name: 'canvas-resume' }), /boom/);
  assert.equal(calls.lockEvals.length, 1);
});

test('start：移除 Redis 裡已經沒有註冊的排程（id 改名或移除後留下的）', async () => {
  const { deps, calls } = fakeDeps({ existing: ['a', 'renamed-old'] });
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'a', every: 1000, run: noop });
  scheduler.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.removed, ['renamed-old']);
});

test('close：關閉 Worker 與 Queue', async () => {
  const { deps, calls } = fakeDeps();
  const scheduler = createJobScheduler(deps);
  scheduler.registerSchedule({ id: 'a', every: 1000, run: noop });
  scheduler.start();
  await scheduler.close();
  assert.equal(calls.workerClosed, true);
  assert.equal(calls.queueClosed, true);
});

test('沒有 start 就 close：只關閉 Queue', async () => {
  const { deps, calls } = fakeDeps();
  await createJobScheduler(deps).close();
  assert.equal(calls.queueClosed, true);
  assert.equal(calls.workerClosed, false);
});
