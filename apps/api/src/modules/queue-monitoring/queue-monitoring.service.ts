/**
 * 佇列監控讀寫的平台層資料（change queue-monitoring）。
 *
 * 平台帳號與平台稽核是平台層的資料表，不屬於任何租戶，所以以 prismaAdmin 讀寫，不收 TenantCtx。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { writePlatformAudit } from '../platform/platform-audit.service.js';

export type PlatformUserStatus = 'ok' | 'not_found' | 'disabled' | 'must_change_password';

/** 監控 cookie 的平台帳號目前的狀態，順序同 authenticatePlatformSuperuser，另外檢查須改密碼 */
export async function getPlatformUserStatus(prisma: PrismaClient, platformUserId: string): Promise<PlatformUserStatus> {
  const user = await prisma.platformUser.findUnique({
    where: { id: platformUserId },
    select: { isActive: true, mustChangePassword: true },
  });
  if (!user) return 'not_found';
  if (!user.isActive) return 'disabled';
  if (user.mustChangePassword) return 'must_change_password';
  return 'ok';
}

/**
 * 重送 job 成功時寫入平台稽核（design 決策 5）。重送已經完成、回應也已送出，
 * 所以寫入失敗時只記 log。
 */
export async function auditJobRetry(
  prisma: PrismaClient,
  input: { platformUserId: string; queueName: string; jobId: string },
): Promise<void> {
  try {
    await writePlatformAudit(prisma, {
      platformUserId: input.platformUserId,
      action: 'queue.job.retry',
      targetType: 'queue_job',
      targetId: `${input.queueName}:${input.jobId}`,
    });
  } catch (err) {
    logger.error(`[queue-monitoring] 重送 ${input.queueName}:${input.jobId} 的稽核寫入失敗`, err);
  }
}
