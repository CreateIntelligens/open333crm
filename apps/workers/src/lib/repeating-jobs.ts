import type { Queue } from 'bullmq';

/** workers 行程的週期 job：每個佇列一個 repeatable job，job id 沿用 job 名稱。 */
export interface RepeatingJob {
  queue: string;
  name: string;
  every: number;
}

export const REPEATING_JOBS: readonly RepeatingJob[] = [
  { queue: 'sla', name: 'sla:poll', every: 300_000 },
  // 資料匯出保留期清理：每小時掃一次，把到期的 completed 轉 expired 並刪 MinIO 物件
  { queue: 'data-export-cleanup', name: 'data-export:cleanup', every: 3_600_000 },
  // 時效標籤清理：每小時掃一次，刪掉 expiresAt 已過的 contact_tags。
  // 用刪列而非查詢時過濾——標籤讀取點過多，逐一加條件必然會漏。
  { queue: 'tag-expiry-cleanup', name: 'tag:expiry-cleanup', every: 3_600_000 },
  { queue: 'agent-retention-cleanup', name: 'agent:retention-cleanup', every: 3_600_000 },
];

/**
 * 註冊每個週期 job，回傳建立的佇列，關機時由呼叫端關閉。
 *
 * 已排定的 repeatable job 會延續註冊時的選項，所以先刪除這個佇列既有的 repeatable job
 * （BullMQ 一併刪除已排好的下一期 job），再以帶保留期限的選項重新註冊。
 * 不改用 upsertJobScheduler()：排程產生的 job id 是 repeat:<排程 id>:<時間>，
 * 排程 id 含 `:` 時 BullMQ 拒絕這個 job id（change queue-monitoring，design 決策 11）。
 */
export async function registerRepeatingJobs(createQueue: (name: string) => Queue): Promise<Queue[]> {
  const queues: Queue[] = [];
  for (const job of REPEATING_JOBS) {
    const queue = createQueue(job.queue);
    queues.push(queue);
    for (const existing of await queue.getRepeatableJobs()) {
      await queue.removeRepeatableByKey(existing.key);
    }
    await queue.add(
      job.name,
      {},
      {
        repeat: { every: job.every },
        jobId: job.name,
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    );
  }
  return queues;
}
