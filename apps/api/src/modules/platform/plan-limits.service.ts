/**
 * 有效數值上限解析。有效上限 = Tenant.limitOverrides[key] ?? Plan.limits[key]。
 * 回傳 null 代表無上限（值為 null、租戶無 plan、或 plan 未定義該 key）。
 */
import type { PrismaClient } from '@prisma/client';

type LimitKey = 'maxAgents' | 'maxTags' | 'monthlyTokens' | 'maxChannels';

/** 給定已載入的 tenant（含 plan）解析有效上限，避免重複查詢。 */
export function resolveEffectiveLimit(
  tenant: { limitOverrides: unknown; plan: { limits: unknown } | null },
  key: LimitKey,
): number | null {
  const overrides = (tenant.limitOverrides ?? {}) as Record<string, number | null>;
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key]; // 含 null（覆寫成無上限）
  }
  if (!tenant.plan) return null;
  const limits = (tenant.plan.limits ?? {}) as Record<string, number | null>;
  return key in limits ? limits[key] : null;
}

/** 查 DB 後解析有效上限。 */
export async function getEffectiveLimit(
  prisma: PrismaClient,
  tenantId: string,
  key: LimitKey,
): Promise<number | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { limitOverrides: true, plan: { select: { limits: true } } },
  });
  if (!tenant) return null;
  return resolveEffectiveLimit(tenant, key);
}
