/**
 * GDPR 資料刪除（被遺忘權，Art.17）服務層。
 *
 * 聯絡人粒度：可「匿名化」（anonymize，保留統計骨架）或「硬刪」（hard_delete，連鎖刪除）。
 * 本層只負責：驗目標聯絡人同租戶 → 建 pending 請求。稽核與刪除工作由 data-erasure.flow.ts 在同一個交易寫入。
 * 實際刪除動作在 apps/workers 的 data-erasure.handler.ts 非同步執行。
 */
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';

export type ErasureMode = 'anonymize' | 'hard_delete';

export const DATA_ERASURE_QUEUE = 'data-erasure';

/**
 * 刪除工作的 BullMQ 選項。job id 是 outbox id，保留期限就是去重的期限，所以以時間計算
 * （docs/ref/modules/EVENTS.md）。不重試：worker 以請求狀態認領，失敗時把請求標成 failed。
 */
export const DATA_ERASURE_JOB_OPTIONS = {
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
};

export interface CreateErasureRequestInput {
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

/**
 * 建立 pending 的資料刪除請求。聯絡人不屬於此租戶時丟 404 CONTACT_NOT_FOUND，不建立請求。
 *
 * @returns 建立的 DataErasureRequest（含 id/status）
 */
export async function createErasureRequest(ctx: TenantCtx, input: CreateErasureRequestInput) {
  const { requestedBy, contactId, mode, reason } = input;

  // 先驗目標聯絡人同租戶——避免跨租戶刪除他人資料
  const contact = await ctx.tx.contact.findFirst({
    where: { id: contactId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!contact) {
    throw new AppError('聯絡人不存在或不屬於此租戶', 'CONTACT_NOT_FOUND', 404);
  }

  return ctx.tx.dataErasureRequest.create({
    data: {
      tenantId: ctx.tenantId,
      requestedBy,
      contactId,
      mode,
      status: 'pending',
      reason: reason ?? null,
    },
  });
}

/**
 * 查單筆刪除請求狀態（一律 tenantId scoped）。
 *
 * @returns DataErasureRequest 或 null（不存在/非本租戶）
 */
export async function getErasureRequest(ctx: TenantCtx, id: string) {
  return ctx.tx.dataErasureRequest.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
}
