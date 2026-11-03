import { PrismaClient, Prisma } from '@prisma/client';
import { systemTemplates } from './seed-data/system-templates.js';
import { seedDemoAccounts, shouldSeedDemoAccounts } from './seed-data/demo-accounts.js';
import { SEED_PLANS } from './seed-data/plans.js';

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
 * 平台方案種子（全域），內容在 seed-data/plans.ts。idempotent upsert（slug 唯一）。
 * 注意：API 容器每次啟動都跑 seed，update 會把這五個方案的 name、features、limits、priceMonthly
 * 寫回這裡的值；allowedChannelTypes 與 permissionOverrides 不寫，保留平台後台的設定。
 */
async function seedPlans() {
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

