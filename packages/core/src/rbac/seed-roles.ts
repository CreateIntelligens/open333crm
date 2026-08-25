/**
 * 為單一租戶建立三個 system role 並種入預設權限（可重入 upsert）。
 * 供 API 的 tenant 開通流程、遷移腳本呼叫。
 *
 * 收 PrismaClient（呼叫端注入，避免 core 直接建 client）。
 * 回傳 slug → roleId 對映，供回填 agent.roleId。
 */

import type { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLE_SLUGS, SYSTEM_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS } from './default-roles';

export async function seedRolesForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Record<string, string>> {
  const slugToId: Record<string, string> = {};

  for (const slug of SYSTEM_ROLE_SLUGS) {
    // upsert role（租戶內 slug 唯一）
    const role = await prisma.role.upsert({
      where: { tenantId_slug: { tenantId, slug } },
      update: { name: SYSTEM_ROLE_NAMES[slug], isSystem: true },
      create: { tenantId, slug, name: SYSTEM_ROLE_NAMES[slug], isSystem: true },
      select: { id: true },
    });
    slugToId[slug] = role.id;

    // 種入預設權限：先清空再重建（可重入、確保與對照表一致）
    const codes = DEFAULT_ROLE_PERMISSIONS[slug];
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (codes.length) {
      await prisma.rolePermission.createMany({
        data: codes.map((permissionCode) => ({ roleId: role.id, permissionCode })),
        skipDuplicates: true,
      });
    }
  }

  return slugToId;
}
