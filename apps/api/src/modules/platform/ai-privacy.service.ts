import { z } from 'zod/v3';
import type { PrismaClient } from '@open333crm/database';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';

const policySchema = z.object({ enabled: z.boolean() }).strict();
const policyKey = (tenantId: string) => `ai.privacy.${tenantId}`;

/** Runtime policy read uses the caller's executor and the explicit tenant key. */
export async function readAiPrivacyPolicy(prisma: TenantDb, tenantId: string): Promise<{ enabled: boolean }> {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: policyKey(tenantId) }, select: { value: true } });
    return row ? policySchema.parse(row.value) : { enabled: false };
  } catch {
    throw new AppError('AI 資料保護設定暫時無法讀取，請稍後重試', 'AI_PRIVACY_POLICY_UNAVAILABLE', 503);
  }
}

export async function getTenantAiPrivacy(prisma: TenantDb, tenantId: string): Promise<{ enabled: boolean }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new AppError('找不到租戶', 'NOT_FOUND', 404);
  return readAiPrivacyPolicy(prisma, tenantId);
}

export async function setTenantAiPrivacy(
  prisma: PrismaClient,
  tenantId: string,
  platformUserId: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new AppError('找不到租戶', 'NOT_FOUND', 404);
    const key = policyKey(tenantId);
    await tx.platformSetting.upsert({ where: { key }, create: { key, value: { enabled } }, update: { value: { enabled } } });
    await tx.platformAuditLog.create({
      data: { platformUserId, action: 'tenant.ai_privacy.update', targetType: 'tenant', targetId: tenantId, payload: { enabled } },
    });
    return { enabled };
  });
}
