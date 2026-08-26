/**
 * 對所有既有租戶重跑 system role 權限種入（reconcile）。
 *
 * 用途：新增/移除 RBAC 權限點（packages/core registry）後，既有租戶的 system role
 * （admin/supervisor/agent）不會自動同步——本腳本對每個租戶重跑 seedRolesForTenant
 * （可重入：先清空該 role 的 RolePermission 再依 DEFAULT_ROLE_PERMISSIONS 重建），
 * 讓既有租戶的 system role 與最新 registry 對齊。
 *
 * ⚠️ 只動 system role（isSystem=true）；租戶自訂角色不受影響。
 *
 * 執行：DATABASE_URL=... node scripts/reconcile-system-role-permissions.mjs
 */
import { PrismaClient } from '@prisma/client';
import { seedRolesForTenant } from '@open333crm/core';

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  console.log(`[reconcile] ${tenants.length} 個租戶待處理`);
  let ok = 0;
  for (const t of tenants) {
    try {
      await prisma.$transaction(async (tx) => {
        await seedRolesForTenant(tx, t.id);
      });
      ok++;
      console.log(`  ✓ ${t.name} (${t.id})`);
    } catch (err) {
      console.error(`  ✗ ${t.name} (${t.id}):`, err.message);
    }
  }
  console.log(`[reconcile] 完成 ${ok}/${tenants.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
