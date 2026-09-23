#!/usr/bin/env node
/**
 * 把 Wave 6 測試殘留的 [E2E] automation rules 標記為已刪除。
 *
 * 背景：deleteRule 原本只把 isActive 設 false，而列表不過濾軟刪資料，
 * 導致 UAT 累積 119 筆已刪規則仍顯示在後台（CM-170）。
 * 修法已改成用 enabled 欄位區分「刪除」與「使用者手動停用」，
 * 但既有資料的 enabled 仍是 true，需要這支腳本回填。
 *
 * 安全設計：
 *   - 只處理名稱含 [E2E] 前綴、且 isActive=false 的規則
 *   - 預設 dry-run，要帶 --apply 才真的寫入
 *
 * 用法：
 *   DATABASE_URL=... node scripts/cleanup-e2e-automation-rules.mjs          # 只看會動到什麼
 *   DATABASE_URL=... node scripts/cleanup-e2e-automation-rules.mjs --apply  # 實際執行
 */
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

try {
  const targets = await prisma.automationRule.findMany({
    where: {
      enabled: true,
      isActive: false,
      name: { contains: '[E2E]' },
    },
    select: { id: true, name: true, tenantId: true },
  });

  console.log(`符合條件（已停用的 [E2E] 測試規則）：${targets.length} 筆`);
  for (const r of targets.slice(0, 5)) {
    console.log(`  - ${r.name.slice(0, 60)}${r.name.length > 60 ? '…' : ''}`);
  }
  if (targets.length > 5) console.log(`  …其餘 ${targets.length - 5} 筆`);

  if (!targets.length) {
    console.log('沒有需要處理的資料。');
  } else if (!apply) {
    console.log('\n[dry-run] 未寫入。確認無誤後加 --apply 實際執行。');
  } else {
    const result = await prisma.automationRule.updateMany({
      where: { id: { in: targets.map((r) => r.id) } },
      data: { enabled: false },
    });
    console.log(`\n✔ 已標記 ${result.count} 筆為已刪除（列表不再顯示）。`);
  }
} finally {
  await prisma.$disconnect();
}
