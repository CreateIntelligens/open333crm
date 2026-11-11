/**
 * 寫入 outbox 與送出 outbox 資料列（change outbox-event-delivery，design 決策 3）。
 *
 * 交易內以 writeOutbox() 寫入，與業務資料一起 commit。commit 之後由快路徑呼叫
 * dispatchOutboxRows()；沒送出的資料列由 api 的 outbox-relay 排程補送。
 * 兩條路徑都以 outbox id 當 job id，BullMQ 不會為同一個 id 建立第二個 job。
 */
import type { Prisma } from '@prisma/client';
import type { JobsOptions } from 'bullmq';
import { logger } from '../logger/index.js';
import { getOutboxQueue, SUBSCRIBER_JOB_OPTIONS, subscriberQueuesOf, type EventJobData, type GetQueue } from './queues.js';

export interface OutboxRow {
  id: string;
  tenantId: string;
  kind: string;
  name: string;
  queueName: string | null;
  payload: Prisma.JsonValue;
  jobOptions: Prisma.JsonValue | null;
  createdAt: Date;
}

/**
 * outbox 的 job 可以帶的選項（白名單）。其他選項可能讓 BullMQ 不建立 job、或不用 outbox id 當 job id，
 * 例如 jobId、deduplication、debounce、repeat；dispatch 卻會把資料列標記已送出，事件就此遺失。
 */
const ALLOWED_JOB_OPTIONS = ['attempts', 'backoff', 'delay', 'priority', 'removeOnComplete', 'removeOnFail'] as const;
export type OutboxJobOptions = Pick<JobsOptions, (typeof ALLOWED_JOB_OPTIONS)[number]>;

export type OutboxInput =
  | { tenantId: string; kind: 'event'; name: string; payload: Record<string, unknown> }
  | { tenantId: string; kind: 'job'; name: string; queueName: string; payload: unknown; jobOptions?: OutboxJobOptions };

const ROW_SELECT = {
  id: true,
  tenantId: true,
  kind: true,
  name: true,
  queueName: true,
  payload: true,
  jobOptions: true,
  createdAt: true,
} as const;

/**
 * 在交易內寫入一筆 outbox。tenantId 必填：workers 用 admin 連線寫入，沒有 RLS 補上租戶。
 * jobOptions 只接受白名單內的選項，其他選項丟錯，所在的交易 rollback。
 */
export async function writeOutbox(tx: Pick<Prisma.TransactionClient, 'outbox'>, input: OutboxInput): Promise<OutboxRow> {
  // 先序列化，再檢查與保存同一份結果：檢查原物件時，toJSON() 可以換掉實際保存的內容
  const jobOptions =
    input.kind === 'job' && input.jobOptions
      ? (JSON.parse(JSON.stringify(input.jobOptions)) as Record<string, unknown>)
      : undefined;
  if (jobOptions) {
    const rejected = Object.keys(jobOptions).filter((key) => !(ALLOWED_JOB_OPTIONS as readonly string[]).includes(key));
    if (rejected.length > 0) {
      throw new Error(`outbox 的 job 不接受 ${rejected.join('、')}：只接受 ${ALLOWED_JOB_OPTIONS.join('、')}`);
    }
  }
  return tx.outbox.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      name: input.name,
      queueName: input.kind === 'job' ? input.queueName : null,
      payload: JSON.parse(JSON.stringify(input.payload ?? null)) as Prisma.InputJsonValue,
      jobOptions: jobOptions as Prisma.InputJsonValue | undefined,
    },
    select: ROW_SELECT,
  });
}

/** outbox 資料列對應的 job：事件給每個訂閱者一個，job 一個 */
function jobsOf(row: OutboxRow): Array<{ queue: string; name: string; data: unknown; opts: Record<string, unknown> }> {
  if (row.kind === 'job') {
    if (!row.queueName) throw new Error(`outbox ${row.id}: kind 'job' 沒有 queueName`);
    const opts = (row.jobOptions ?? {}) as Record<string, unknown>;
    return [{ queue: row.queueName, name: row.name, data: row.payload, opts: { ...opts, jobId: row.id } }];
  }
  const data: EventJobData = {
    eventId: row.id,
    name: row.name,
    tenantId: row.tenantId,
    timestamp: row.createdAt.toISOString(),
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
  return subscriberQueuesOf(row.name).map((queue) => ({
    queue,
    name: row.name,
    data,
    opts: { ...SUBSCRIBER_JOB_OPTIONS, jobId: row.id },
  }));
}

/**
 * 為每一列建立 job，全部建立成功之後才標記已送出。一列失敗只記 log，該列留給 relay 補送，
 * 不影響其他列，也不丟錯。db 要能更新任何租戶的 outbox（commit 之後的連線沒有綁定租戶）。
 */
export async function dispatchOutboxRows(
  db: Pick<Prisma.TransactionClient, 'outbox'>,
  rows: OutboxRow[],
  getQueue: GetQueue = getOutboxQueue,
): Promise<void> {
  const dispatched: string[] = [];
  for (const row of rows) {
    try {
      for (const job of jobsOf(row)) {
        const created = (await getQueue(job.queue).add(job.name, job.data, job.opts)) as { id?: unknown } | undefined;
        // id 相同的 job 已存在時，BullMQ 回傳那個 job，id 仍相同。id 不同或沒有 job，代表這筆沒有送出
        if (created?.id !== row.id) throw new Error(`${job.queue} 沒有建立 id 為 ${row.id} 的 job`);
      }
      dispatched.push(row.id);
    } catch (err) {
      logger.error(`[outbox] 送出失敗，留給 relay 補送（${row.kind} ${row.name} ${row.id}）`, err);
    }
  }
  if (dispatched.length === 0) return;
  await db.outbox.updateMany({ where: { id: { in: dispatched }, dispatchedAt: null }, data: { dispatchedAt: new Date() } });
}
