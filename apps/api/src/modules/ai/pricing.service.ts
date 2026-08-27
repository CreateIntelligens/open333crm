/**
 * Model pricing — 查價與成本計算。
 *
 * 單價存 DB（ModelPricing，平台全域、(model, effectiveFrom) 版本化），
 * 查價取 effectiveFrom <= now 的最新一列，進程內快取 10 分鐘。
 * 成本全程用 Prisma.Decimal 運算（金額不可經 float）。
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient, ModelPricing } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { TokenUsage } from './providers/types.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const pricingCache = new Map<string, { value: ModelPricing | null; expiresAt: number }>();

const MILLION = new Prisma.Decimal(1_000_000);

export async function getPricing(
  prisma: TenantDb,
  model: string,
): Promise<ModelPricing | null> {
  const cached = pricingCache.get(model);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pricing = await prisma.modelPricing.findFirst({
    where: { model, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
  });
  pricingCache.set(model, { value: pricing, expiresAt: Date.now() + CACHE_TTL_MS });
  return pricing;
}

/** 測試/改價後手動清快取用 */
export function clearPricingCache(): void {
  pricingCache.clear();
}

/**
 * 成本 = (prompt − cached) × input + cached × cached價 + (candidates + thoughts) × output。
 * thinking token 按 output 價（Google 計費規則）；cached 是 prompt 的子集要先扣除。
 * 設有 tierThreshold 且 promptTokens 超過時，整筆改用 tier 價。
 * 回傳 null 代表查無價目（呼叫端記 0 並標 usageMissing）。
 */
export function calcCostUsd(usage: TokenUsage, pricing: ModelPricing | null): Prisma.Decimal | null {
  if (!pricing) return null;

  const overTier =
    pricing.tierThreshold !== null &&
    pricing.tierInputPer1M !== null &&
    pricing.tierOutputPer1M !== null &&
    usage.promptTokens > pricing.tierThreshold;

  const inputPer1M = overTier ? pricing.tierInputPer1M! : pricing.inputPer1M;
  const outputPer1M = overTier ? pricing.tierOutputPer1M! : pricing.outputPer1M;

  const uncachedPrompt = new Prisma.Decimal(Math.max(usage.promptTokens - usage.cachedTokens, 0));
  const cachedPrompt = new Prisma.Decimal(usage.cachedTokens);
  const output = new Prisma.Decimal(usage.candidatesTokens + usage.thoughtsTokens);

  return uncachedPrompt
    .mul(inputPer1M)
    .add(cachedPrompt.mul(pricing.cachedPer1M))
    .add(output.mul(outputPer1M))
    .div(MILLION);
}
