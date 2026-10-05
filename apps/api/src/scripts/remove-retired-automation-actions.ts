/**
 * 移除既有自動化規則中已從契約拿掉的動作（AUDIT AUTO-01，issue #197，change fix-automation-remaining-actions）。
 *
 * 2026-10-05 起契約不再定義 assign_bot、kb_auto_reply、llm_reply。含這些動作的既有規則，契約驗證失敗，
 * workers 整條略過（原本只略過這幾個動作），規則列表會標示「規則不會執行」。這支腳本把這 3 種動作移除，
 * 讓規則的其他動作恢復執行。
 *
 * 安全設計：
 *   - 預設 dry-run，只列出受影響的規則；帶 --apply 才寫入
 *   - 只動 actions 欄位，只移除這 3 種動作，其他動作保留原順序；可重複執行
 *   - 移除後沒有任何動作的規則不寫入，列出來由管理員決定刪除或改設定
 *   - 逐租戶查詢，每個 query 都帶 tenantId
 *
 * 用法（在 apps/api 目錄）：
 *   DATABASE_URL=<owner 或 app_admin> npx tsx src/scripts/remove-retired-automation-actions.ts
 *   DATABASE_URL=<owner 或 app_admin> npx tsx src/scripts/remove-retired-automation-actions.ts --apply
 */
import { prisma } from '@open333crm/database';
import { removeRetiredActions } from '../modules/automation/retired-actions.js';

const apply = process.argv.includes('--apply');
// 跨租戶掃描：使用共用 client（不自建 PrismaClient），DATABASE_URL 需指向 owner / app_admin（BYPASSRLS）

async function main() {
  const report = await removeRetiredActions(prisma, { apply });
  if (report.length === 0) {
    console.log('沒有規則含 assign_bot、kb_auto_reply、llm_reply。');
    console.log('若資料庫確實有這類規則，代表 DATABASE_URL 不是 owner／app_admin（受 RLS 限制），請改用 owner 連線');
    return;
  }
  for (const r of report) {
    const status = r.remaining === 0 ? '移除後沒有動作，未寫入，請管理員處理' : r.updated ? '已移除' : '將移除';
    console.log(`${r.tenantId}  ${r.id}  ${r.name}  移除：${r.removed.join('、')}  剩 ${r.remaining} 個動作  ${status}`);
  }
  console.log(`\n共 ${report.length} 條規則受影響`);
  if (!apply) console.log('(dry-run) 加上 --apply 才會寫入');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
