/**
 * 寫入 outbox 與送出 outbox 資料列（change outbox-event-delivery，design 決策 3）。
 *
 * 交易內以 writeOutbox() 寫入，與業務資料一起 commit。commit 之後由快路徑呼叫
 * dispatchOutboxRows()；沒送出的資料列由 api 的 outbox-relay 排程補送。
 * 兩條路徑都以 outbox id 當 job id，BullMQ 不會為同一個 id 建立第二個 job。
 */
import type { Prisma } from '@prisma/client';
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

export type OutboxInput =
  | { tenantId: string; kind: 'event'; name: string; payload: Record<string, unknown> }
  | { tenantId: string; kind: 'job'; name: string; queueName: string; payload: unknown; jobOptions?: Record<string, unknown> };

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
 * jobOptions 的 jobId 會被 outbox id 取代。
 */
export async function writeOutbox(tx: Pick<Prisma.TransactionClient, 'outbox'>, input: OutboxInput): Promise<OutboxRow> {
  return tx.outbox.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      name: input.name,
      queueName: input.kind === 'job' ? input.queueName : null,
      payload: JSON.parse(JSON.stringify(input.payload ?? null)) as Prisma.InputJsonValue,
      jobOptions:
        input.kind === 'job' && input.jobOptions
          ? (JSON.parse(JSON.stringify(input.jobOptions)) as Prisma.InputJsonValue)
          : undefined,
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
        await getQueue(job.queue).add(job.name, job.data, job.opts);
      }
      dispatched.push(row.id);
    } catch (err) {
      logger.error(`[outbox] 送出失敗，留給 relay 補送（${row.kind} ${row.name} ${row.id}）`, err);
    }
  }
  if (dispatched.length === 0) return;
  await db.outbox.updateMany({ where: { id: { in: dispatched }, dispatchedAt: null }, data: { dispatchedAt: new Date() } });
}
