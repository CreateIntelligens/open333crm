/**
 * 資料匯出的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 發起匯出時，請求、稽核與匯出工作在同一個交易寫入（主規格 tenant-data-export「發起匯出的寫入一起成立」）：
 * 其中一項寫不進去時一起 rollback。匯出工作寫進 outbox，commit 之後送進 data-export 佇列，至少送出一次；
 * worker 以請求狀態認領，重複的工作不會產生第二則完成通知（「worker 不重新處理已結束的匯出請求」）。
 */
import type { PrismaClient } from '@prisma/client';
import { createOutboxPublisher, enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { getFileUrl } from '../storage/storage.service.js';
import {
  countExportDownload,
  createExportRequest,
  DATA_EXPORT_JOB_OPTIONS,
  DATA_EXPORT_QUEUE,
  findDownloadableExport,
  getExportRequest,
  type CreateExportRequestInput,
  type DataExportJobData,
} from './data-export.service.js';

/** 下載連結的有效秒數 */
const DOWNLOAD_URL_TTL_SECONDS = 900;

export const getExportRequestFlow = flowOf(getExportRequest);

/** 發起匯出的入口：events 預設寫 outbox（測試可替換） */
export interface RequestExportDeps {
  prisma: PrismaClient;
  events?: EventPublisher;
}

export function requestExportFlow(
  deps: RequestExportDeps,
  actor: RequestActor,
  input: Pick<CreateExportRequestInput, 'scope'>,
) {
  const events = deps.events ?? createOutboxPublisher(deps.prisma);
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const req = await createExportRequest(scope, { requestedBy: actor.agentId, scope: input.scope });
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'data.export.request',
      targetType: 'data_export_request',
      targetId: req.id,
      payload: input.scope ? { scope: input.scope } : undefined,
      ip: actor.ip,
    });
    const job: DataExportJobData = { requestId: req.id, tenantId: actor.tenantId, requestedBy: actor.agentId };
    await enqueueJob(scope, events, DATA_EXPORT_QUEUE, 'data-export:generate', job, DATA_EXPORT_JOB_OPTIONS);
    return req;
  });
}

/**
 * 下載已完成的匯出檔：檢查請求、產短時效下載連結、downloadCount++。
 * 下載連結以固定憑證在本機簽章（S3 presigner），不連網路，所以留在交易內；簽章失敗時不增計數。
 */
export function getExportDownloadFlow(deps: { prisma: PrismaClient }, tenantId: string, id: string) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const fileKey = await findDownloadableExport(scope, id);
    const url = await getFileUrl(fileKey, DOWNLOAD_URL_TTL_SECONDS);
    await countExportDownload(scope, id);
    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  });
}
