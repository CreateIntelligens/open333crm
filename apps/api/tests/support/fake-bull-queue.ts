/**
 * bull-board 測試用的假 BullMQ 佇列（change queue-monitoring）。
 *
 * BullMQAdapter 以 metaValues.version 認得非 Queue 實例的佇列。只實作監控會用到的方法；
 * job 的狀態與重送都記在記憶體裡。
 */
import type { Queue } from 'bullmq';

export interface FakeJob {
  id: string;
  name: string;
  state: 'failed' | 'completed' | 'waiting' | 'active' | 'delayed';
  data: Record<string, unknown>;
  failedReason?: string;
  stacktrace?: string[];
  attemptsMade?: number;
  returnvalue?: unknown;
}

export interface FakeQueueHandle {
  queue: Queue;
  jobs: Map<string, FakeJob>;
  /** 每次重送記一筆：job id 與重送時的狀態 */
  retries: Array<{ id: string; state: string }>;
  /** 每個寫入 Redis 的呼叫都記一筆，用來確認被拒絕的請求沒有改變佇列 */
  writes: string[];
}

export function fakeBullQueue(name: string, jobs: FakeJob[] = []): FakeQueueHandle {
  const handle: FakeQueueHandle = {
    queue: undefined as unknown as Queue,
    jobs: new Map(jobs.map((job) => [job.id, job])),
    retries: [],
    writes: [],
  };
  const toJob = (job: FakeJob) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    opts: {},
    progress: 0,
    attemptsMade: job.attemptsMade ?? 0,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace ?? [],
    returnvalue: job.returnvalue,
    timestamp: 0,
    processedOn: undefined,
    finishedOn: undefined,
    isPaused: false,
    getState: async () => job.state,
    retry: async (state: string) => {
      handle.retries.push({ id: job.id, state });
      job.state = 'waiting';
    },
    toJSON() {
      return { id: job.id, name: job.name, data: job.data, opts: {}, progress: 0, attemptsMade: job.attemptsMade ?? 0,
        failedReason: job.failedReason, stacktrace: job.stacktrace ?? [], returnvalue: job.returnvalue, timestamp: 0 };
    },
  });
  const write = (op: string) => async () => {
    handle.writes.push(op);
  };
  handle.queue = {
    name,
    opts: {},
    metaValues: { version: 'bullmq:5.71.0' },
    getJob: async (id: string) => {
      const job = handle.jobs.get(id);
      return job ? toJob(job) : undefined;
    },
    getJobCounts: async () => ({}),
    getJobs: async () => [],
    isPaused: async () => false,
    getJobLogs: async () => ({ logs: [], count: 0 }),
    add: write('add'),
    clean: write('clean'),
    drain: write('drain'),
    obliterate: write('obliterate'),
    pause: write('pause'),
    resume: write('resume'),
    promoteJobs: write('promoteJobs'),
    retryJobs: write('retryJobs'),
    setGlobalConcurrency: write('setGlobalConcurrency'),
    removeJobScheduler: write('removeJobScheduler'),
  } as unknown as Queue;
  return handle;
}
