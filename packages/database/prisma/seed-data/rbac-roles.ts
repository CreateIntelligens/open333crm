/**
 * Demo seed 的 RBAC 角色種子（內嵌版）。
 *
 * database 套件不可 import @open333crm/core（core→database 會循環依賴），
 * 故此處內嵌與 core/rbac/default-roles.ts 等效的權限對照。
 * ⚠️ 若 core 的預設對照有變更，此檔需同步（兩者以 core 為準）。
 */

import type { PrismaClient } from '@prisma/client';

const SUPERVISOR_CODES = [
  'inbox.view', 'inbox.reply', 'inbox.manage',
  'case.view', 'case.create', 'case.update', 'case.assign', 'case.escalate', 'case.delete',
  'contact.view', 'contact.update', 'contact.merge',
  'tag.view', 'tag.manage',
  'knowledge.view', 'knowledge.manage', 'knowledge.admin',
  'shortlink.view', 'shortlink.manage',
  'canvas.use', 'identity.review',
  'automation.view',
  'channel.view', 'richmenu.manage', 'quickreply.manage',
  'marketing.view', 'marketing.manage', 'marketing.broadcast',
  'analytics.view', 'analytics.view.self', 'analytics.export',
  'settings.manage', 'sla.manage', 'webhook.view',
  'agent.view', 'agent.manage', 'agent.role.assign',
  'billing.view',
];

const AGENT_CODES = [
  'inbox.view', 'inbox.reply', 'inbox.manage',
  'case.view', 'case.create', 'case.update', 'case.assign', 'case.escalate', 'case.delete',
  'contact.view', 'contact.update', 'contact.merge',
  'tag.view', 'tag.manage',
  'knowledge.view', 'knowledge.manage',
  'shortlink.view', 'shortlink.manage',
  'canvas.use', 'identity.review',
  'analytics.view.self',
  'agent.view',
];

// admin = 全部權限（含平台鎖定核心）；此處用 SUPERVISOR ∪ 剩餘 admin-only 補齊
const ADMIN_ONLY = [
  'channel.create', 'channel.update', 'channel.delete',
  'automation.manage', 'portal.view', 'portal.manage',
  'webhook.manage', 'agent.password.reset', 'agent.delete',
  'role.view', 'role.manage',
];
const ADMIN_CODES = Array.from(new Set([...SUPERVISOR_CODES, ...ADMIN_ONLY]));

const DEFAULTS: Record<string, { name: string; codes: string[] }> = {
  admin: { name: 'Admin', codes: ADMIN_CODES },
  supervisor: { name: 'Supervisor', codes: SUPERVISOR_CODES },
  agent: { name: 'Agent', codes: AGENT_CODES },
};

/** 為租戶建三 system role + 種預設權限，回傳 slug→roleId。 */
export async function seedDemoRoles(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Record<string, string>> {
  const slugToId: Record<string, string> = {};
  for (const slug of ['admin', 'supervisor', 'agent']) {
    const { name, codes } = DEFAULTS[slug];
    const role = await prisma.role.upsert({
      where: { tenantId_slug: { tenantId, slug } },
      update: { name, isSystem: true },
      create: { tenantId, slug, name, isSystem: true },
      select: { id: true },
    });
    slugToId[slug] = role.id;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: codes.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      skipDuplicates: true,
    });
  }
  return slugToId;
}
