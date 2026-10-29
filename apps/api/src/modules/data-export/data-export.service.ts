/**
 * 資料匯出（GDPR Art.20 可攜權）服務。
 *
 * 本層只負責建立 pending 請求、查詢請求與下載前的檢查。稽核與匯出工作由 data-export.flow.ts 在同一個交易寫入。
 * 實際撈資料、打包 zip、上傳 MinIO 由 apps/workers 的 data-export.handler 非同步處理。
 *
 * 所有查詢一律帶 tenantId，確保跨租戶隔離。
 */
import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';

/** 匯出 job 的 BullMQ queue 名稱（與 apps/workers 端消費者一致）。 */
export const DATA_EXPORT_QUEUE = 'data-export';

/**
 * 匯出工作的 BullMQ 選項。job id 是 outbox id，保留期限就是去重的期限，所以以時間計算
 * （queue-monitoring「各佇列 job 的保留期限」、docs/ref/modules/EVENTS.md）。
 */
export const DATA_EXPORT_JOB_OPTIONS = {
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
};

/** BullMQ job payload（只帶識別欄位）。 */
export interface DataExportJobData {
  requestId: string;
  tenantId: string;
  requestedBy: string;
}

export interface CreateExportRequestInput {
  requestedBy: string;
  /** 匯出範圍（哪些資料類型）；未指定＝全部。 */
  scope?: Prisma.InputJsonValue;
}

/** 建立 pending 的匯出請求。 */
export async function createExportRequest(ctx: TenantCtx, input: CreateExportRequestInput) {
  return ctx.tx.dataExportRequest.create({
    data: {
      tenantId: ctx.tenantId,
      requestedBy: input.requestedBy,
      status: 'pending',
      scope: input.scope,
    },
    select: {
      id: true,
      status: true,
      scope: true,
      createdAt: true,
    },
  });
}

/** 查單筆匯出請求狀態（tenantId scoped）。 */
export async function getExportRequest(ctx: TenantCtx, id: string) {
  const req = await ctx.tx.dataExportRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: {
      id: true,
      status: true,
      scope: true,
      fileSizeBytes: true,
      downloadCount: true,
      error: true,
      expiresAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  if (!req) {
    throw new AppError('匯出請求不存在', 'NOT_FOUND', 404);
  }
  return req;
}

/**
 * 下載前的檢查：驗 completed + 未過期 + 同租戶，回傳檔案的 key。
 * 跨租戶（findFirst 帶 tenantId 找不到）→ 404；未完成/已過期 → 400/410。
 */
export async function findDownloadableExport(ctx: TenantCtx, id: string): Promise<string> {
  const req = await ctx.tx.dataExportRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: {
      id: true,
      status: true,
      fileKey: true,
      expiresAt: true,
    },
  });
  if (!req) {
    throw new AppError('匯出請求不存在', 'NOT_FOUND', 404);
  }
  if (req.status !== 'completed' || !req.fileKey) {
    throw new AppError('匯出尚未完成或已失效', 'EXPORT_NOT_READY', 400);
  }
  if (req.expiresAt && req.expiresAt.getTime() <= Date.now()) {
    throw new AppError('匯出檔已過期', 'EXPORT_EXPIRED', 410);
  }
  return req.fileKey;
}

/** downloadCount++（仍再次以 tenantId 限定，防越權）。 */
export async function countExportDownload(ctx: TenantCtx, id: string): Promise<void> {
  await ctx.tx.dataExportRequest.updateMany({
    where: { id, tenantId: ctx.tenantId },
    data: { downloadCount: { increment: 1 } },
  });
}
