/**
 * 平台方案種子定義（全域）。seed.ts 的 seedPlans() 以 slug upsert 寫入。
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
 * 平台方案種子（全域）。idempotent upsert（slug 唯一）。
 * 注意：API 容器每次啟動都跑 seed，update 會把這五個方案的 name、features、limits、priceMonthly
 * 寫回這裡的值；allowedChannelTypes 與 permissionOverrides 不寫，保留平台後台的設定。
 * @param prisma Prisma client（owner 連線）；測試只需提供 plan model
 */
export async function seedPlans(prisma: Pick<PrismaClient, 'plan'>): Promise<void> {
  for (const p of SEED_PLANS) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        features: p.features as Prisma.InputJsonValue,
        limits: p.limits as Prisma.InputJsonValue,
        priceMonthly: p.priceMonthly,
      },
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
