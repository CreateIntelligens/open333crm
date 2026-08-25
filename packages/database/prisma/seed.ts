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

  console.log(`Seed complete: 1 tenant, 3 agents (with roleId), 3 system roles, ${systemTemplates.length} system templates`);
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
        tenantId: null,
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

