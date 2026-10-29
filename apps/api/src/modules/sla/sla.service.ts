/**
 * SLA 政策的讀寫。
 *
 * 工單以政策「名稱」記錄套用的政策（Case.slaPolicy 是字串，AUDIT SLA-04），SLA 掃描依名稱回查。
 * 因此：名稱在租戶內不可重複、改名要同步工單、仍有未結案工單時不能刪（G20）。
 */
import type { Prisma, Priority } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

export interface SlaPolicyInput {
  name: string;
  priority: Priority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  warningBeforeMinutes: number;
  isDefault: boolean;
}

/** 未結案（仍受 SLA 監控）的工單狀態以外的狀態 */
const CLOSED_CASE_STATUSES = ['RESOLVED', 'CLOSED'] as const;

/**
 * 同一租戶的 SLA 政策寫入（建立、改名、刪除）依序執行。
 * 名稱檢查與刪除前的工單計數都是「先查再寫」，沒有鎖時並行請求會一起通過檢查。
 * schema 沒有 (tenantId, name) 唯一約束，且既有資料可能已有重名，所以用交易級 advisory lock，
 * 交易結束自動釋放。
 */
async function lockTenantSlaPolicies(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sla-policy:${tenantId}`}, 0))`;
}

async function assertNameAvailable(tx: Prisma.TransactionClient, tenantId: string, name: string, exceptId?: string) {
  const dup = await tx.slaPolicy.findFirst({
    where: { tenantId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (dup) {
    throw new AppError(`已有名為「${name}」的 SLA 政策，請換一個名稱`, 'DUPLICATE', 409);
  }
}

export async function listSlaPolicies({ tx, tenantId }: TenantCtx) {
  return tx.slaPolicy.findMany({
    where: { tenantId },
    orderBy: { priority: 'asc' },
  });
}

export async function createSlaPolicy({ tx, tenantId }: TenantCtx, data: SlaPolicyInput) {
  await lockTenantSlaPolicies(tx, tenantId);
  await assertNameAvailable(tx, tenantId, data.name);
  // If setting as default, unset other defaults for same priority
  if (data.isDefault) {
    await tx.slaPolicy.updateMany({
      where: { tenantId, priority: data.priority, isDefault: true },
      data: { isDefault: false },
    });
  }
  return tx.slaPolicy.create({ data: { tenantId, ...data } });
}

export async function updateSlaPolicy({ tx, tenantId }: TenantCtx, id: string, data: Partial<SlaPolicyInput>) {
  await lockTenantSlaPolicies(tx, tenantId);
  const policy = await tx.slaPolicy.findFirst({ where: { id, tenantId } });
  if (!policy) {
    throw new AppError(notFound('slaPolicy'), 'NOT_FOUND', 404);
  }
  const oldName = policy.name;
  const renamed = data.name !== undefined && data.name !== oldName;
  if (renamed) await assertNameAvailable(tx, tenantId, data.name!, id);
  if (data.isDefault) {
    await tx.slaPolicy.updateMany({
      where: { tenantId, priority: data.priority || policy.priority, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }
  const updated = await tx.slaPolicy.update({ where: { id }, data });
  // 同一個交易內把工單上記的舊名稱改成新名稱，否則這些工單從此不受 SLA 監控
  if (renamed) {
    await tx.case.updateMany({
      where: { tenantId, slaPolicy: oldName },
      data: { slaPolicy: data.name },
    });
  }
  return updated;
}

export async function deleteSlaPolicy({ tx, tenantId }: TenantCtx, id: string) {
  // 與改名互斥：否則計數時看的是舊名稱，刪掉的卻是剛改名、工單已改記新名稱的政策
  await lockTenantSlaPolicies(tx, tenantId);
  const policy = await tx.slaPolicy.findFirst({ where: { id, tenantId } });
  if (!policy) {
    throw new AppError(notFound('slaPolicy'), 'NOT_FOUND', 404);
  }
  // 未結案的工單還在用這條政策計時：刪掉後 SLA 掃描找不到政策，工單默默停止計時
  const openCaseCount = await tx.case.count({
    where: { tenantId, slaPolicy: policy.name, status: { notIn: [...CLOSED_CASE_STATUSES] } },
  });
  if (openCaseCount > 0) {
    throw new AppError(
      `仍有 ${openCaseCount} 張未結案的工單使用此政策，刪除後這些工單會停止 SLA 計時。請等工單結案後再刪除，或改用編輯調整時限`,
      'SLA_POLICY_IN_USE',
      409,
      { openCaseCount },
    );
  }
  await tx.slaPolicy.delete({ where: { id } });
  return { deleted: true };
}
