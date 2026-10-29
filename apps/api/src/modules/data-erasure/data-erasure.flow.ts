/**
 * GDPR 資料刪除的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 發起刪除時，請求、稽核與刪除工作在同一個交易寫入（主規格 tenant-data-erasure「發起刪除的寫入一起成立」）：
 * 其中一項寫不進去時一起 rollback。刪除工作寫進 outbox，commit 之後送進 data-erasure 佇列，至少送出一次；
 * worker 以請求狀態認領，同一個請求的刪除最多 commit 一次，所以重複的工作不會刪兩次。
 */
import type { PrismaClient } from '@prisma/client';
import { createOutboxPublisher, enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  createErasureRequest,
  DATA_ERASURE_JOB_OPTIONS,
  DATA_ERASURE_QUEUE,
  getErasureRequest,
  type DataErasureJobData,
  type ErasureMode,
} from './data-erasure.service.js';

export const getErasureRequestFlow = flowOf(getErasureRequest);

/** 發起刪除的入口：events 預設寫 outbox（測試可替換） */
export interface RequestErasureDeps {
  prisma: PrismaClient;
  events?: EventPublisher;
}

export function requestErasureFlow(
  deps: RequestErasureDeps,
  actor: RequestActor,
  input: { contactId: string; mode: ErasureMode; reason?: string },
) {
  const events = deps.events ?? createOutboxPublisher(deps.prisma);
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const erasure = await createErasureRequest(scope, { requestedBy: actor.agentId, ...input });
    // payload 不含 PII 與 reason，只放 contactId/mode
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'data.erasure.request',
      targetType: 'contact',
      targetId: input.contactId,
      payload: { contactId: input.contactId, mode: input.mode },
      ip: actor.ip,
    });
    const job: DataErasureJobData = {
      requestId: erasure.id,
      tenantId: actor.tenantId,
      contactId: input.contactId,
      mode: input.mode,
      requestedBy: actor.agentId,
    };
    await enqueueJob(scope, events, DATA_ERASURE_QUEUE, 'data-erasure:process', job, DATA_ERASURE_JOB_OPTIONS);
    return erasure;
  });
}
