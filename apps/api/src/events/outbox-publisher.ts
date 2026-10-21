/**
 * TenantCtx 用的事件送出方式（change outbox-event-delivery，design 決策 5）：
 * 交易內寫 outbox，commit 之後以快路徑送進佇列。
 *
 * 快路徑在 commit 之後執行，原本的交易已經結束；標記已送出時另開一個綁定該租戶的短交易，
 * 所以仍受 RLS 約束，不需要 admin 連線。
 */
import type { PrismaClient } from '@prisma/client';
import { dispatchOutboxRows, writeOutbox } from '@open333crm/core';
import type { EventPublisher } from '../lib/tenant-ctx.js';
import { withTenant } from '../lib/tenant-db.js';

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
