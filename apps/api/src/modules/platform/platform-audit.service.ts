/**
 * 平台稽核 log 寫入 helper。平台側寫入操作（開通/停用租戶、改 plan、改設定）都應留一筆。
 */
import type { PrismaClient, Prisma } from '@prisma/client';

export async function writePlatformAudit(
  prisma: PrismaClient,
  input: {
    platformUserId: string;
    action: string;
    targetType?: string;
    targetId?: string;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await prisma.platformAuditLog.create({
    data: {
      platformUserId: input.platformUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload,
    },
  });
}
