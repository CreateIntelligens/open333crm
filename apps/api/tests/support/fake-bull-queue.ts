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
  /** 每次讀取狀態之後呼叫，用來模擬兩次讀取之間狀態改變 */
  onGetState?: () => void;
}

export interface FakeQueueHandle {
  queue: Queue;
  jobs: Map<string, FakeJob>;
  /** 每次重送記一筆：job id 與重送時的狀態 */
  retries: Array<{ id: string; state: string }>;
  /** 每個寫入 Redis 的呼叫都記一筆，用來確認被拒絕的請求沒有改變佇列 */
  writes: string[];
}

export interface FakeScheduler {
  key: string;
  name: string;
  every?: number;
  template?: { data?: unknown; opts?: Record<string, unknown> };
}

export function fakeBullQueue(name: string, jobs: FakeJob[] = [], schedulers: FakeScheduler[] = []): FakeQueueHandle {
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
    // 同 BullMQ 的 reprocessJob：只從指定的狀態集合移出 job，job 不在那個集合時丟錯（Lua 回傳 -3）
    getState: async () => {
      const state = job.state;
      job.onGetState?.();
      return state;
    },
    retry: async (state: string) => {
      if (job.state !== state) throw new Error(`Job ${job.id} is not in the ${state} state. reprocessJob`);
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
    getJobLogs: async () => ({ logs: ['客人的電話是 0912345678'], count: 1 }),
    getJobSchedulers: async () => schedulers,
    getJobSchedulersCount: async () => schedulers.length,
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
