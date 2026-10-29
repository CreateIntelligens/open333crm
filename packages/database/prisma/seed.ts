import { PrismaClient, Prisma } from '@prisma/client';
import { systemTemplates } from './seed-data/system-templates.js';
import { seedDemoAccounts, shouldSeedDemoAccounts } from './seed-data/demo-accounts.js';

const prisma = new PrismaClient();

async function main() {
  const demo = shouldSeedDemoAccounts(process.env);
  if (demo) await seedDemoAccounts(prisma);

  await seedSystemTemplates();

  await seedModelPricing();

  await seedPlans();

  console.log(
    `Seed complete: ${demo ? 'demo tenant, 3 agents, 3 system roles, 1 platform user, ' : 'demo accounts skipped, '}${systemTemplates.length} system templates, model pricing, 5 plans`,
  );
}

/**
 * 平台方案種子（全域）。features = 功能天花板；limits.null = 無上限。
 * idempotent upsert（slug 唯一）。改方案內容 = 改這裡或平台後台，零改碼影響租戶。
 */
async function seedPlans() {
  const plans = [
    {
      slug: 'trial',
      name: '免費試用',
      features: ['inbox', 'knowledge', 'core'],
      limits: { maxAgents: 3, maxTags: 50, monthlyTokens: 200_000 },
      priceMonthly: 0,
    },
    {
      slug: 'light',
      name: '輕量版',
      features: ['inbox', 'core'],
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
  for (const p of plans) {
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

/**
 * 模型單價種子（平台全域）。以固定 effectiveFrom 搭配 (model, effectiveFrom)
 * 唯一鍵做 idempotent upsert——重跑不會產生重複列。
 * 改價時「新增一列較新的 effectiveFrom」，不要修改這裡的歷史值。
 * 單價為每 1M token 的 USD（2026-08 官方牌價）；Ollama 本機模型不查表、成本恆 0。
 */
async function seedModelPricing() {
  const EFFECTIVE_FROM = new Date('2026-08-20T00:00:00Z');
  const pricings = [
    { model: 'gemini-2.5-flash', inputPer1M: 0.3, outputPer1M: 2.5, cachedPer1M: 0.03 },
    { model: 'gemini-2.5-flash-lite', inputPer1M: 0.1, outputPer1M: 0.4, cachedPer1M: 0.01 },
    {
      model: 'gemini-2.5-pro',
      inputPer1M: 1.25,
      outputPer1M: 10.0,
      cachedPer1M: 0.125,
      // 超過 200k prompt token 整筆改用 tier 價
      tierThreshold: 200_000,
      tierInputPer1M: 2.5,
      tierOutputPer1M: 15.0,
    },
  ];
  for (const p of pricings) {
    await prisma.modelPricing.upsert({
      where: { model_effectiveFrom: { model: p.model, effectiveFrom: EFFECTIVE_FROM } },
      update: {},
      create: { ...p, effectiveFrom: EFFECTIVE_FROM },
    });
  }
}

async function seedSystemTemplates() {
  for (const tpl of systemTemplates) {
    const variablesJson = (tpl.variables ?? []) as unknown as Prisma.InputJsonValue;
    await prisma.messageTemplate.upsert({
      where: { id: tpl.id },
      update: {
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        channelType: tpl.channelType,
        contentType: tpl.contentType,
        body: tpl.body as Prisma.InputJsonValue,
        variables: variablesJson,
        previewImageUrl: tpl.previewImageUrl,
        isSystem: true,
        isActive: true,
      },
      create: {
        id: tpl.id,
        // 不寫 tenantId=null：RLS policy（"tenantId" = uuid）讀不到 null 列，
        // 系統共用模板須改用其他機制。日後重啟系統模板時勿還原此欄位（CM-155 問題 2）。
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        channelType: tpl.channelType,
        contentType: tpl.contentType,
        body: tpl.body as Prisma.InputJsonValue,
        variables: variablesJson,
        previewImageUrl: tpl.previewImageUrl,
        isSystem: true,
        isActive: true,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed failed:', e.message);
    await prisma.$disconnect();
    process.exit(1);
  });

