/**
 * Demo seed 的 RBAC 角色種子。
 *
 * 權限對照與 core 的 seedRolesForTenant() 用同一份：@open333crm/shared 的 DEFAULT_ROLE_PERMISSIONS。
 * database 套件不能 import @open333crm/core（core 依賴 database，會循環依賴），所以表放在 shared。
 * 這裡原本是手抄的副本，新增的權限碼沒有同步，每次部署都把 Demo Tenant 的系統角色還原成過時的副本（2026-10-29）。
 */

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, SYSTEM_ROLE_NAMES, SYSTEM_ROLE_SLUGS } from '@open333crm/shared';

/** 為租戶建三 system role + 種預設權限，回傳 slug→roleId。 */
export async function seedDemoRoles(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Record<string, string>> {
  const slugToId: Record<string, string> = {};
  for (const slug of SYSTEM_ROLE_SLUGS) {
    const name = SYSTEM_ROLE_NAMES[slug];
    const codes = DEFAULT_ROLE_PERMISSIONS[slug];
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
