import { PrismaClient, AgentRole, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { systemTemplates } from './seed-data/system-templates.js';
// 注意：database 套件不可 import @open333crm/core（會與 core→database 循環依賴）。
// 正式的 seedRolesForTenant 在 core（供 API 用）；此處為 demo seed 的內嵌等效版。
import { seedDemoRoles } from './seed-data/rbac-roles.js';

const prisma = new PrismaClient();

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

const agents = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    email: 'admin@open333crm.dev',
    name: 'Admin',
    role: AgentRole.ADMIN,
    password: 'Admin1234!',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    email: 'supervisor@open333crm.dev',
    name: 'Supervisor',
    role: AgentRole.SUPERVISOR,
    password: 'Super1234!',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    email: 'agent@open333crm.dev',
    name: 'Agent',
    role: AgentRole.AGENT,
    password: 'Agent1234!',
  },
];

async function main() {
  // Tenant must exist before agents (FK constraint)
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: 'Demo Tenant', isActive: true },
    create: { id: TENANT_ID, name: 'Demo Tenant', isActive: true },
  });

  // RBAC: 為 demo 租戶建三 system role + 種預設權限，取得 slug→roleId 對映
  const slugToRoleId = await seedDemoRoles(prisma, TENANT_ID);

  for (const { id, password, ...data } of agents) {
    const passwordHash = await bcrypt.hash(password, 10);
    // 依 enum 對映到 system role slug，回填 roleId
    const slug = { ADMIN: 'admin', SUPERVISOR: 'supervisor', AGENT: 'agent' }[data.role];
    const roleId = slug ? slugToRoleId[slug] : null;
    await prisma.agent.upsert({
      // email 全域唯一，直接用 email 當 where（複合鍵 tenantId_email 已移除）
      where: { email: data.email },
      update: { name: data.name, role: data.role, roleId, passwordHash, isActive: true },
      create: { id, tenantId: TENANT_ID, ...data, roleId, passwordHash, isActive: true },
    });
  }

  await seedSystemTemplates();

  await seedModelPricing();

  await seedPlans();

  await seedPlatformUser();

  console.log(`Seed complete: 1 tenant, 3 agents (with roleId), 3 system roles, ${systemTemplates.length} system templates, model pricing, 5 plans, 1 platform user`);
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
 * dev 平台 superuser 種子。prod 由部署腳本另建（勿用此 dev 密碼）。
 */
async function seedPlatformUser() {
  const passwordHash = await bcrypt.hash('Platform1234!', 10);
  await prisma.platformUser.upsert({
    where: { email: 'platform@open333crm.dev' },
    update: { name: 'Platform Admin', passwordHash, isActive: true },
    create: { email: 'platform@open333crm.dev', name: 'Platform Admin', passwordHash },
  });
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

