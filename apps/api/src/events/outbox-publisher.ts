/**
 * 業務事件與佇列 job 的送出方式（change outbox-event-delivery，design 決策 5）：
 * 交易內寫 outbox，commit 之後以快路徑送進佇列。保證是至少一次：快路徑沒送出的，由 outbox-relay 補送。
 *
 * publishEvent、enqueueJob 收 inTenant() 的 scope，由入口（flow、背景工作）呼叫，service 不呼叫
 * （change migrate-role-agent-tenant-ctx，決策 6）。
 *
 * 快路徑在 commit 之後執行，原本的交易已經結束；標記已送出時另開一個綁定該租戶的短交易，
 * 所以仍受 RLS 約束，不需要 admin 連線。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  dispatchOutboxRows,
  logger,
  writeOutbox,
  type OutboxInput,
  type OutboxJobOptions,
  type OutboxRow,
} from '@open333crm/core';
import type { TenantScope } from '../lib/tenant-ctx.js';
import { withTenant } from '../lib/tenant-db.js';
import type { AppEventName } from './event-bus.js';

/** 正式程式用 createOutboxPublisher()，單元測試注入假的實作 */
export interface EventPublisher {
  /** 在交易內寫入一筆 outbox */
  write(tx: Prisma.TransactionClient, input: OutboxInput): Promise<OutboxRow>;
  /** commit 之後的快路徑：送進佇列並標記已送出。失敗的資料列留給 relay 補送 */
  dispatch(rows: OutboxRow[]): Promise<void>;
}

/** commit 之後交給快路徑。不 await：Redis 沒有回應時 add() 可能一直不結束，回傳不能跟著卡住 */
function dispatchAfterCommit(scope: TenantScope, publisher: EventPublisher, label: string, row: OutboxRow) {
  scope.afterCommit(label, () => {
    // 失敗只記 log：資料列已在 outbox，relay 會補送
    publisher.dispatch([row]).catch((err: unknown) => {
      logger.error(`[outbox] commit 後送出失敗，留給 relay 補送（${label}）`, err);
    });
  });
}

/** 在交易內寫進 outbox，事件的 tenantId 由 scope 填入；commit 之後送給訂閱者 */
export async function publishEvent(
  scope: TenantScope,
  publisher: EventPublisher,
  name: AppEventName,
  payload: Record<string, unknown>,
): Promise<void> {
  const row = await publisher.write(scope.tx, { tenantId: scope.tenantId, kind: 'event', name, payload });
  dispatchAfterCommit(scope, publisher, `publish ${name}`, row);
}

/**
 * 在交易內寫進 outbox；commit 之後送進 queueName 的佇列，job id 是 outbox id。
 * opts 只接受 OutboxJobOptions 的白名單（attempts、backoff、delay、priority、removeOnComplete、removeOnFail）
 */
export async function enqueueJob(
  scope: TenantScope,
  publisher: EventPublisher,
  queueName: string,
  name: string,
  data: unknown,
  opts?: OutboxJobOptions,
): Promise<void> {
  const row = await publisher.write(scope.tx, {
    tenantId: scope.tenantId,
    kind: 'job',
    queueName,
    name,
    payload: data,
    ...(opts ? { jobOptions: opts } : {}),
  });
  dispatchAfterCommit(scope, publisher, `enqueue ${name}`, row);
}

export function createOutboxPublisher(prisma: PrismaClient): EventPublisher {
  return {
    write: (tx, input) => writeOutbox(tx, input),
    async dispatch(rows) {
      const byTenant = new Map<string, typeof rows>();
      for (const row of rows) byTenant.set(row.tenantId, [...(byTenant.get(row.tenantId) ?? []), row]);
      for (const [tenantId, tenantRows] of byTenant) {
        const db = {
          outbox: {
            updateMany: (args: Parameters<PrismaClient['outbox']['updateMany']>[0]) =>
              withTenant(prisma, tenantId, (tx) => tx.outbox.updateMany(args)),
          },
        };
        await dispatchOutboxRows(db as never, tenantRows);
      }
    },
  };
}
