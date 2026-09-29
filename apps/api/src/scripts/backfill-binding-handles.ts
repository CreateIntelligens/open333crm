/**
 * 為既有 LINE／FB／IG 渠道補抓跨渠道綁定用的導流識別（change add-cross-channel-one-id，tasks 4.3）。
 *
 * 新渠道在後台按「驗證」時會自動寫入 settings.bindingHandleAuto；這支腳本替既有渠道
 * 補跑一次同樣的驗證（直接重用 verifyChannel，不另寫一份邏輯）。
 *
 * 安全設計：
 *   - 預設 dry-run，只列出缺導流識別的渠道；帶 --apply 才實際呼叫平台 API 並寫入
 *   - 單一渠道驗證失敗（權杖過期等）只記錄、不中斷其他渠道
 *   - 每個渠道都在自己租戶的 withTenant 交易內執行
 *
 * 用法（在 apps/api 目錄）：
 *   DATABASE_URL=<owner 或 app_admin> CREDENTIAL_ENCRYPTION_KEY=... npx tsx src/scripts/backfill-binding-handles.ts
 *   ... npx tsx src/scripts/backfill-binding-handles.ts --apply
 */
import { prisma } from '@open333crm/database';
import { withTenant } from '../lib/tenant-db.js';
import { verifyChannel } from '../modules/channel/channel.service.js';

const apply = process.argv.includes('--apply');
// 跨租戶掃描：使用共用 client（不自建 PrismaClient），DATABASE_URL 需指向 owner / app_admin（BYPASSRLS）

function hasHandle(settings: unknown): boolean {
  const s = (settings ?? {}) as Record<string, unknown>;
  return Boolean(s.bindingHandle || s.bindingHandleAuto);
}

async function main() {
  const channels = await prisma.channel.findMany({
    where: { isActive: true, channelType: { in: ['LINE', 'FB', 'THREADS'] } },
    select: { id: true, tenantId: true, channelType: true, displayName: true, settings: true },
    orderBy: [{ tenantId: 'asc' }, { channelType: 'asc' }],
  });
  const missing = channels.filter((c) => !hasHandle(c.settings));

  console.log(`啟用中的 LINE/FB/IG 渠道 ${channels.length} 個，缺導流識別 ${missing.length} 個`);
  for (const c of missing) console.log(`  - [${c.channelType}] ${c.displayName} (${c.id}) tenant=${c.tenantId}`);

  if (!apply) {
    console.log('\n(dry-run) 加上 --apply 才會實際向平台查詢並寫入');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const c of missing) {
    try {
      await withTenant(prisma, c.tenantId, (tx) => verifyChannel(tx, c.id, c.tenantId));
      const after = await prisma.channel.findFirst({ where: { id: c.id, tenantId: c.tenantId }, select: { settings: true } });
      const handle = (after?.settings as Record<string, unknown> | null)?.bindingHandleAuto;
      if (handle) {
        ok++;
        console.log(`  完成 [${c.channelType}] ${c.displayName} → ${String(handle)}`);
      } else {
        failed++;
        console.log(`  驗證成功但平台未回傳識別 [${c.channelType}] ${c.displayName}，請在後台手動填寫`);
      }
    } catch (err) {
      failed++;
      console.log(`  失敗 [${c.channelType}] ${c.displayName}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n完成 ${ok} 個，需人工處理 ${failed} 個`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // channel.service 的相依模組會建立 Redis 連線，不主動結束進程會一直掛著
    process.exit();
  });
