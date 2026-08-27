/**
 * GDPR 資料刪除（被遺忘權，Art.17）服務層。
 *
 * 聯絡人粒度：可「匿名化」（anonymize，保留統計骨架）或「硬刪」（hard_delete，連鎖刪除）。
 * 本層只負責：驗目標聯絡人同租戶 → 建 pending 請求 → 寫稽核 → 入列 BullMQ job。
 * 實際刪除動作在 apps/workers 的 data-erasure.handler.ts 非同步執行。
 */
import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { Queue } from 'bullmq';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';
import { writeTenantAudit } from '../tenant-audit/tenant-audit.service.js';

export type ErasureMode = 'anonymize' | 'hard_delete';

export interface RequestErasureInput {
  tenantId: string;
  requestedBy: string;
  contactId: string;
  mode: ErasureMode;
  reason?: string;
}

/** BullMQ job payload（只帶最小識別欄位，不含 PII）。 */
export interface DataErasureJobData {
  requestId: string;
  tenantId: string;
  contactId: string;
  mode: ErasureMode;
  requestedBy: string;
}

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL 導致 ioredis fallback 6379 噪音。
let _erasureQueue: Queue<DataErasureJobData> | null = null;
function erasureQueue(): Queue<DataErasureJobData> {
  if (!_erasureQueue) {
    _erasureQueue = new Queue<DataErasureJobData>('data-erasure', {
      connection: { url: process.env.REDIS_URL! },
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
    });
  }
  return _erasureQueue;
}

// 入列 seam：預設走 BullMQ；測試可用 setEnqueueErasureJob 注入替身避免真連 Redis。
let enqueueImpl: (data: DataErasureJobData) => Promise<unknown> = (data) =>
  erasureQueue().add('data-erasure:process', data);

/** 測試用：覆寫入列實作（避免單元測試連 Redis）。傳 null 還原預設。 */
export function setEnqueueErasureJob(
  fn: ((data: DataErasureJobData) => Promise<unknown>) | null,
): void {
  enqueueImpl =
    fn ?? ((data) => erasureQueue().add('data-erasure:process', data));
}

/**
 * 建立資料刪除請求。
 *
 * 流程：驗聯絡人同租戶（不存在→404）→ 建 pending DataErasureRequest →
 * 寫租戶稽核（action=data.erasure.request，payload 只放 contactId/mode，不含 PII）→ 入列 job。
 *
 * @param prisma Prisma client
 * @param input tenantId / requestedBy / contactId / mode / reason
 * @returns 建立的 DataErasureRequest（含 id/status）
 */
export async function requestErasure(prisma: TenantDb, input: RequestErasureInput) {
  const { tenantId, requestedBy, contactId, mode, reason } = input;

  // 1. 先驗目標聯絡人同租戶——避免跨租戶刪除他人資料
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { id: true },
  });
  if (!contact) {
    throw new AppError('聯絡人不存在或不屬於此租戶', 'CONTACT_NOT_FOUND', 404);
  }

  // 2. 建 pending 請求
  const erasure = await prisma.dataErasureRequest.create({
    data: {
      tenantId,
      requestedBy,
      contactId,
      mode,
      status: 'pending',
      reason: reason ?? null,
    },
  });

  // 3. 寫租戶稽核（payload 不含 PII，只放 contactId/mode）
  await writeTenantAudit(prisma, {
    tenantId,
    actorId: requestedBy,
    action: 'data.erasure.request',
    targetType: 'contact',
    targetId: contactId,
    payload: { contactId, mode },
  });

  // 4. 入列 BullMQ job。入列失敗（如 Redis 不可用）時把請求標 failed 並拋，避免永久卡 pending。
  try {
    await enqueueImpl({
      requestId: erasure.id,
      tenantId,
      contactId,
      mode: mode as ErasureMode,
      requestedBy,
    });
  } catch (err) {
    logger.error(`[data-erasure] enqueue failed for request ${erasure.id}:`, err);
    await prisma.dataErasureRequest
      .update({ where: { id: erasure.id }, data: { status: 'failed', error: '入列失敗，請重試' } })
      .catch((e) => logger.error('[data-erasure] mark failed also failed:', e));
    throw new AppError('刪除請求入列失敗，請稍後重試', 'ENQUEUE_FAILED', 503);
  }

  return erasure;
}

/**
 * 查單筆刪除請求狀態（一律 tenantId scoped）。
 *
 * @returns DataErasureRequest 或 null（不存在/非本租戶）
 */
export async function getErasureRequest(prisma: TenantDb, tenantId: string, id: string) {
  return prisma.dataErasureRequest.findFirst({
    where: { id, tenantId },
  });
}

/** 測試/優雅關閉用：關閉 queue 連線。 */
export async function closeErasureQueue(): Promise<void> {
  if (!_erasureQueue) return;
  await _erasureQueue.close();
  _erasureQueue = null;
}
