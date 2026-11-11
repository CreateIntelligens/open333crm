/**
 * API 程序內的定時工作：以 BullMQ Job Scheduler 觸發，取代各模組自己的 setInterval。
 *
 * 排程的定義存在 Redis。不論有幾個 API 實例，每一期只產生一筆 job，由一個 Worker 執行
 * （相當於 Laravel 的 onOneServer()，一律成立）。Worker 在 API 程序內執行，所以工作用得到 fastify.io。
 * 同一筆 job 可能執行不只一次：執行中的行程被強制結束時，BullMQ 判定 job stalled 而重新執行。
 * 所以 run 要承受重跑，寄信或改狀態之前先以條件更新認領資料。
 *
 * BullMQ 在 Worker 取走這一期的 job 時就產生下一期，不等這一期跑完。所以一個工作可能比週期
 * 跑得久時，設定 withoutOverlapping：Worker 先搶這個工作的 Redis 鎖，搶不到就略過這一期。
 * 鎖的存活時間是「這個工作最久會跑多久」。正常情況下 job 結束就釋放鎖；行程當掉、或執行超過
 * 存活時間時，鎖才會到期失效，這時下一期可以開始。
 *
 * 行為（2026-10-19 以 bullmq 5.71 實測）：
 * - 第一次註冊時，every 排程立刻執行一次；pattern 排程等到下一個時間點。之後重啟時，
 *   設定沒變就不重新註冊（見 upsertIfChanged），下次執行時間不變，已到期的那一期會補跑。
 *   改了設定再註冊時，every 排程會立刻執行一次。
 * - Redis 斷線時，upsertJobScheduler() 會等到 Redis 恢復才完成，不會丟錯，所以註冊不 await。
 * - start() 時移除 Redis 裡沒有註冊的排程（id 改名或移除後留下的）。
 *   Redis 恢復後，到期的那一期補跑一次，更早錯過的期數不補。
 */
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type RepeatOptions } from 'bullmq';
import { logger } from '@open333crm/core';

export interface ScheduleDefinition {
  /** 排程 id，也是 job 名稱與鎖的 key。改名會留下舊的排程在 Redis */
  id: string;
  /** 週期毫秒。every 與 pattern 剛好設定一個 */
  every?: number;
  /** cron，用 API 程序的時區（容器沒有設定 TZ 時是 UTC） */
  pattern?: string;
  /** 可能比週期跑得久時設定。expiresInMs 是這個工作最久會跑多久，不是週期 */
  withoutOverlapping?: { expiresInMs: number };
  run: () => Promise<unknown>;
}

export interface JobScheduler {
  /** 在 start() 之前呼叫。不等 Redis 回應 */
  registerSchedule(def: ScheduleDefinition): void;
  /** 所有排程註冊完後呼叫，建立 Worker */
  start(): void;
  close(): Promise<void>;
}

type Processor = (job: { name: string }) => Promise<void>;

export interface JobSchedulerDeps {
  queue: {
    upsertJobScheduler(id: string, repeat: Omit<RepeatOptions, 'key'>, template: { name: string; opts: JobOptions }): Promise<unknown>;
    getJobScheduler(id: string): Promise<
      { every?: number | string | null; pattern?: string | null; template?: { opts?: Record<string, unknown> } } | undefined
    >;
    getJobSchedulers(): Promise<{ key: string }[]>;
    removeJobScheduler(id: string): Promise<boolean>;
    close(): Promise<void>;
  };
  lock: {
    set(key: string, value: string, mode: 'PX', ttlMs: number, nx: 'NX'): Promise<string | null>;
    eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  };
  createWorker(processor: Processor, concurrency: number): { close(): Promise<void> };
}

/**
 * 每個排程產生的 job 保留多少筆，註冊時寫進排程的 template。BullMQ 把 template 存在排程裡，
 * 所以改了這裡，upsertIfChanged() 會比對到不同而重新註冊，已存在的排程也會套用新值。
 *
 * 不要直接刪掉一個鍵：upsertIfChanged() 只比對這裡有的鍵，刪掉的鍵比對不到，已存在的排程
 * 會一直保留舊值。要取消一個設定時，改成 BullMQ 的預設值，例如 `removeOnFail: false`
 * （全部保留）。比對只看這裡的鍵，不反過來檢查 Redis 裡的鍵：BullMQ 若在 template 加了
 * 別的鍵，每次啟動都會重新註冊，已到期的 cron 那一期就不會補跑。
 */
const JOB_OPTIONS = { removeOnComplete: 100, removeOnFail: 50 };
type JobOptions = typeof JOB_OPTIONS;

const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export function createJobScheduler(deps: JobSchedulerDeps): JobScheduler {
  const schedules = new Map<string, ScheduleDefinition>();
  let worker: { close(): Promise<void> } | null = null;

  async function runWithoutOverlapping(def: ScheduleDefinition, expiresInMs: number): Promise<void> {
    const key = `scheduler-lock:${def.id}`;
    // 每次執行用不同的值，釋放時只刪自己的鎖，不會刪到鎖過期後別人剛搶到的鎖
    const value = randomUUID();
    const acquired = await deps.lock.set(key, value, 'PX', expiresInMs, 'NX');
    if (acquired !== 'OK') return; // 上一期還在跑，略過這一期
    try {
      await def.run();
    } finally {
      await deps.lock.eval(RELEASE_LOCK_LUA, 1, key, value).catch((err: unknown) => {
        logger.warn(`[JobScheduler] 釋放 "${def.id}" 的鎖失敗，等存活時間到期:`, err);
      });
    }
  }

  /**
   * Redis 裡已經有同樣設定（every、pattern、JOB_OPTIONS）的排程時，不重新註冊。BullMQ 重新註冊 cron 排程時，會把已到期、
   * 還沒執行的 job 換成下一個時間點：API 停機跨過 02:00 再啟動，那一天的彙總就不會補跑。
   */
  async function upsertIfChanged(def: ScheduleDefinition): Promise<void> {
    const stored = await deps.queue.getJobScheduler(def.id);
    if (stored) {
      const storedEvery = stored.every == null ? undefined : Number(stored.every);
      const storedPattern = stored.pattern ?? undefined;
      const storedOpts = stored.template?.opts ?? {};
      const sameOpts = Object.entries(JOB_OPTIONS).every(([key, value]) => storedOpts[key] === value);
      if (storedEvery === def.every && storedPattern === def.pattern && sameOpts) return;
    }
    const repeat = def.every !== undefined ? { every: def.every } : { pattern: def.pattern };
    await deps.queue.upsertJobScheduler(def.id, repeat, { name: def.id, opts: JOB_OPTIONS });
  }

  async function removeUnregistered(): Promise<void> {
    for (const { key } of await deps.queue.getJobSchedulers()) {
      if (schedules.has(key)) continue;
      await deps.queue.removeJobScheduler(key);
      logger.info(`[JobScheduler] 移除沒有註冊的排程: ${key}`);
    }
  }

  const processor: Processor = async (job) => {
    const def = schedules.get(job.name);
    if (!def) throw new Error(`[JobScheduler] 沒有註冊的排程: ${job.name}`);
    if (def.withoutOverlapping) {
      await runWithoutOverlapping(def, def.withoutOverlapping.expiresInMs);
    } else {
      await def.run();
    }
  };

  return {
    registerSchedule(def) {
      if (worker) throw new Error(`[JobScheduler] Worker 已啟動，不能再註冊排程: ${def.id}`);
      if (schedules.has(def.id)) throw new Error(`[JobScheduler] 排程 id 重複: ${def.id}`);
      if ((def.every === undefined) === (def.pattern === undefined)) {
        throw new Error(`[JobScheduler] every 與 pattern 要剛好設定一個: ${def.id}`);
      }
      schedules.set(def.id, def);
      upsertIfChanged(def).catch((err: unknown) => {
        logger.error(`[JobScheduler] 註冊排程 "${def.id}" 失敗:`, err);
      });
    },

    start() {
      if (worker) return;
      worker = deps.createWorker(processor, schedules.size);
      // 排程 id 改名或移除後，舊的排程還留在 Redis，每一期都會因為沒有註冊而失敗
      void removeUnregistered().catch((err: unknown) => {
        logger.warn('[JobScheduler] 清除沒有註冊的排程失敗:', err);
      });
      logger.info(`[JobScheduler] Started — ${[...schedules.keys()].join(', ')}`);
    },

    async close() {
      await worker?.close();
      await deps.queue.close();
    },
  };
}

/** @param queueName 只有測試需要改，用來和其他測試隔開 */
export function createBullJobScheduler(redisUrl: string, queueName = 'api-scheduler'): JobScheduler {
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const queue = new Queue(queueName, { connection });
  queue.on('error', (err) => logger.warn('[JobScheduler] Queue error:', err.message));

  return createJobScheduler({
    queue,
    // 鎖用 Queue 自己的 Redis 連線：import 這個檔案時不開連線，也不多開一條
    lock: {
      set: async (key, value, mode, ttlMs, nx) => (await queue.client).set(key, value, mode, ttlMs, nx),
      eval: async (script, numKeys, ...args) => (await queue.client).eval(script, numKeys, ...args),
    },
    createWorker(processor, concurrency) {
      const worker = new Worker(queueName, processor, { connection, concurrency });
      worker.on('error', (err) => logger.warn('[JobScheduler] Worker error:', err.message));
      worker.on('failed', (job, err) => logger.error(`[JobScheduler] 排程 "${job?.name}" 執行失敗:`, err));
      return worker;
    },
  });
}
