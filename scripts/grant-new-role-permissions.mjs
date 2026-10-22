/**
 * 只「補上」新增的權限點到既有租戶的 system role，不動其他權限。
 *
 * 為什麼不用 reconcile-system-role-permissions.mjs：reconcile 會把 admin／supervisor／agent 的權限
 * 整組清空再依預設表重建，租戶在權限頁對 system role 做過的調整（例如拿掉座席的 contact.update）
 * 會被還原且沒有提示（code review 2026-10-21）。新增權限點時改用本腳本。
 *
 * 規則：對每個租戶的每個 system role，只加入「指定的權限碼 ∩ 該角色的預設權限」，已存在的略過。
 * 跑完要清權限快取（Redis 權限交集快取；見 AGENTS.md 與 docs/ref/modules/PERMISSIONS.md）。
 *
 * 執行（以優惠券上線為例）：
 *   DATABASE_URL=... node scripts/grant-new-role-permissions.mjs \
 *     coupon.view coupon.manage coupon.issue coupon.redeem store.view store.manage
 * 加 --dry-run 只列出會補上的權限，不寫入。
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CODES } from '@open333crm/core';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const codes = args.filter((a) => !a.startsWith('--'));

if (codes.length === 0) {
  console.error('請指定要補上的權限碼，例如：node scripts/grant-new-role-permissions.mjs coupon.view coupon.issue');
  process.exit(1);
}
const unknown = codes.filter((c) => !PERMISSION_CODES.has(c));
if (unknown.length > 0) {
  console.error(`權限碼不存在：${unknown.join(', ')}`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({
    where: { isSystem: true, slug: { in: Object.keys(DEFAULT_ROLE_PERMISSIONS) } },
    select: { id: true, slug: true, tenantId: true, permissions: { select: { permissionCode: true } } },
  });
  let added = 0;
  for (const role of roles) {
    const have = new Set(role.permissions.map((p) => p.permissionCode));
    const missing = codes.filter((c) => DEFAULT_ROLE_PERMISSIONS[role.slug].includes(c) && !have.has(c));
    if (missing.length === 0) continue;
    console.log(`  ${role.tenantId} ${role.slug}: + ${missing.join(', ')}`);
    added += missing.length;
    if (!dryRun) {
      await prisma.rolePermission.createMany({
        data: missing.map((permissionCode) => ({ roleId: role.id, permissionCode })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`[grant] ${dryRun ? '（dry-run）會' : '已'}補上 ${added} 筆權限，涵蓋 ${roles.length} 個 system role`);
  if (!dryRun && added > 0) console.log('[grant] 請清除權限快取（Redis），否則最多要等快取過期才生效');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
