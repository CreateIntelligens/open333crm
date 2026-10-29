/**
 * Demo 租戶、Demo 成員與 dev 平台帳號的種子。
 * 密碼寫在公開的原始碼裡，只給本機開發用。API 容器每次啟動都跑 seed（docker-entrypoint.sh），
 * 所以正式環境預設不建這些帳號；帳號已經存在時也不覆寫密碼與啟用狀態，
 * 改過的密碼與停用狀態不會在下次部署被還原（issue #394）。
 */

import { AgentRole, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedDemoRoles } from './rbac-roles.js';

export const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

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

const PLATFORM_USER = { email: 'platform@open333crm.dev', name: 'Platform Admin', password: 'Platform1234!' };

/**
 * @description 是否要建 Demo 帳號：`NODE_ENV=production` 時不建，除非 `SEED_DEMO_ACCOUNTS=true`
 * @param env 環境變數
 * @returns 要建時回 true
 */
export function shouldSeedDemoAccounts(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.SEED_DEMO_ACCOUNTS === 'true';
}

/**
 * @description 建 Demo 租戶、三個 Demo 成員與 dev 平台帳號
 * @param prisma Prisma client（owner 連線）
 */
export async function seedDemoAccounts(prisma: PrismaClient): Promise<void> {
  // Tenant must exist before agents (FK constraint)
  await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    update: { name: 'Demo Tenant' },
    create: { id: DEMO_TENANT_ID, name: 'Demo Tenant', isActive: true },
  });

  // RBAC: 為 demo 租戶建三 system role + 種預設權限，取得 slug→roleId 對映
  const slugToRoleId = await seedDemoRoles(prisma, DEMO_TENANT_ID);

  for (const { id, password, ...data } of agents) {
    const passwordHash = await bcrypt.hash(password, 10);
    // 依 enum 對映到 system role slug，回填 roleId
    const slug = { ADMIN: 'admin', SUPERVISOR: 'supervisor', AGENT: 'agent' }[data.role];
    const roleId = slug ? slugToRoleId[slug] : null;
    await prisma.agent.upsert({
      // email 全域唯一，直接用 email 當 where（複合鍵 tenantId_email 已移除）
      where: { email: data.email },
      update: { name: data.name, role: data.role, roleId },
      create: { id, tenantId: DEMO_TENANT_ID, ...data, roleId, passwordHash, isActive: true },
    });
  }

  const passwordHash = await bcrypt.hash(PLATFORM_USER.password, 10);
  await prisma.platformUser.upsert({
    where: { email: PLATFORM_USER.email },
    update: { name: PLATFORM_USER.name },
    create: { email: PLATFORM_USER.email, name: PLATFORM_USER.name, passwordHash },
  });
}
