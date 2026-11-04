/**
 * 平台方案種子定義（全域）。seedPlans() 只建立資料庫還沒有的方案，不更新既有方案（#441）。
 * features = 功能天花板；limits 的值 null = 無上限，沒有列出的 key 也是無上限。
 * 抽成獨立檔案，讓單元測試與 feature 測試用同一份方案內容（seed.ts 匯入時會直接執行）。
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export interface SeedPlan {
  slug: string;
  name: string;
  features: string[];
  limits: Record<string, number | null>;
  priceMonthly: number | null;
}

export const SEED_PLANS: SeedPlan[] = [
  {
    slug: 'trial',
    name: '免費試用',
    features: ['inbox', 'channels', 'knowledge', 'core'],
    limits: { maxAgents: 3, maxTags: 50, monthlyTokens: 200_000 },
    priceMonthly: 0,
  },
  {
    slug: 'light',
    name: '輕量版',
    features: ['inbox', 'channels', 'core'],
    limits: { maxAgents: 5, maxTags: 100, monthlyTokens: 1_500_000 },
    priceMonthly: 1800,
  },
  {
    slug: 'standard',
    name: '標準版',
    features: ['inbox', 'channels', 'knowledge', 'core'],
    limits: { maxAgents: 10, maxTags: 500, monthlyTokens: 3_000_000 },
    priceMonthly: 3600,
  },
  {
    slug: 'professional',
    name: '專業版',
    features: ['inbox', 'channels', 'marketing', 'analytics', 'knowledge', 'core'],
    limits: { maxAgents: 20, maxTags: 1000, monthlyTokens: 8_000_000 },
    priceMonthly: 7200,
  },
  {
    slug: 'enterprise',
    name: '企業版',
    features: ['inbox', 'channels', 'automation', 'marketing', 'analytics', 'knowledge', 'portal', 'core'],
    limits: { maxAgents: null, maxTags: null, monthlyTokens: null },
    priceMonthly: null,
  },
];

/**
 * @description 平台方案種子（全域）：只建立資料庫還沒有的方案，已存在的方案一律不更新。
 *
 * API 容器每次啟動都跑 seed（apps/api/docker-entrypoint.sh）。平台在 /admin/plans 改過的
 * name、features、limits、priceMonthly、allowedChannelTypes、permissionOverrides、isActive
 * 都必須在部署後保留（issue #441，AUDIT PLAN-20），所以 upsert 的 update 留空物件，
 * 已存在的方案不寫入任何欄位。
 *
 * 規則：程式要改「既有」方案的內容時，不要改這裡期待部署生效（這裡的值只影響新建的資料庫）。
 * 寫一支一次性的資料 migration：只改目標方案的目標欄位、加上「還沒改過」的條件讓它可重複執行，
 * 並在檔頭寫回滾 SQL。範例：migrations/20261103120000_enable_channels_on_trial_light。
 * 同時更新本檔的 SEED_PLANS，讓新環境與既有環境一致。
 *
 * @param prisma Prisma client（owner 連線）；測試只需提供 plan model
 */
export async function seedPlans(prisma: Pick<PrismaClient, 'plan'>): Promise<void> {
  // 與 seed.ts 的 seedModelPricing() 同一種「只建立不覆寫」寫法：upsert 的 update 留空物件
  for (const p of SEED_PLANS) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        slug: p.slug,
        name: p.name,
        features: p.features as Prisma.InputJsonValue,
        limits: p.limits as Prisma.InputJsonValue,
        priceMonthly: p.priceMonthly,
      },
    });
  }
}
