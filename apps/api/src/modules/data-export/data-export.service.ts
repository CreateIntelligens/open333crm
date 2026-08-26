/**
 * 資料匯出（GDPR Art.20 可攜權）服務。
 *
 * 發起匯出後：建立一筆 pending DataExportRequest、寫租戶稽核、入列 BullMQ job（queue: data-export）。
 * 實際撈資料、打包 zip、上傳 MinIO 由 apps/workers 的 data-export.handler 非同步處理。
 *
 * 所有查詢一律帶 tenantId，確保跨租戶隔離。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppError } from '../../shared/utils/response.js';
import { writeTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { getFileUrl } from '../storage/storage.service.js';

/** 匯出 job 的 BullMQ queue 名稱（與 apps/workers 端消費者一致）。 */
export const DATA_EXPORT_QUEUE = 'data-export';

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL。
let _exportQueue: Queue | null = null;
function exportQueue(): Queue {
  if (!_exportQueue) {
    _exportQueue = new Queue(DATA_EXPORT_QUEUE, {
      connection: { url: process.env.REDIS_URL! },
    });
  }
  return _exportQueue;
}

/** 關閉 export queue 連線（測試 / 優雅關機用）。 */
export async function closeExportQueue(): Promise<void> {
  if (!_exportQueue) return;
  await _exportQueue.close();
  _exportQueue = null;
}

export interface RequestExportInput {
  tenantId: string;
  requestedBy: string;
  /** 匯出範圍（哪些資料類型）；未指定＝全部。 */
  scope?: Prisma.InputJsonValue;
  ip?: string;
}

/**
 * 發起匯出：建 pending 請求 + 寫稽核 + 入列 job。
 * 立即回傳請求（pending 狀態），不阻塞於實際打包。
 */
export async function requestExport(prisma: PrismaClient, input: RequestExportInput) {
  const req = await prisma.dataExportRequest.create({
    data: {
      tenantId: input.tenantId,
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

  // 稽核：發起匯出（非阻斷）
  await writeTenantAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.requestedBy,
    action: 'data.export.request',
    targetType: 'data_export_request',
    targetId: req.id,
    payload: input.scope ? { scope: input.scope } : undefined,
    ip: input.ip,
  });

  // 入列非同步 job（Path B：worker 撈資料 + 打包 + 上傳）
  await exportQueue().add('data-export:generate', {
    requestId: req.id,
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
  });

  return req;
}

/** 查單筆匯出請求狀態（tenantId scoped）。 */
export async function getExportRequest(prisma: PrismaClient, tenantId: string, id: string) {
  const req = await prisma.dataExportRequest.findFirst({
    where: { id, tenantId },
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
 * 取得下載資訊：驗 completed + 未過期 + 同租戶，產短時效下載連結並 downloadCount++。
 * 跨租戶（findFirst 帶 tenantId 找不到）→ 404；未完成/已過期 → 400/410。
 */
export async function getExportDownload(prisma: PrismaClient, tenantId: string, id: string) {
  const req = await prisma.dataExportRequest.findFirst({
    where: { id, tenantId },
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

  // 產短時效 presigned 下載連結（15 分鐘）
  const url = await getFileUrl(req.fileKey, 900);

  // downloadCount++（仍再次以 tenantId 限定，防越權）
  await prisma.dataExportRequest.updateMany({
    where: { id, tenantId },
    data: { downloadCount: { increment: 1 } },
  });

  return { url, expiresInSeconds: 900 };
}
