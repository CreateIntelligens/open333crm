#!/usr/bin/env node
/**
 * 停用「啟用中但不合自動化契約」的規則（change fix-automation-rule-gaps，問題清單 A02）。
 *
 * 背景：2026-03 舊版 seed 建立的規則含契約沒有的動作（auto_assign）或觸發事件（sentiment.negative）。
 * workers 執行前用同一份契約驗證，失敗就整條略過、只寫 log；列表上這種規則仍顯示「啟用」。
 * 這兩個舊代碼在現行契約都沒有對應的寫法：
 *   - auto_assign：自動化建立的工單不走輪派，「指派客服」要指定客服，無法自動換成等價動作。
 *   - sentiment.negative：系統沒有這個觸發事件，負面情緒只是 SLA 事件的條件欄位。
 * 所以只停用、不改內容。管理員打開規則時，編輯器會標出要刪除的動作或要改選的觸發事件，
 * 修正後即可重新啟用（API 會拒絕啟用仍不合契約的規則）。
 *
 * 安全設計：
 *   - 只處理 enabled = true（未刪除）且 isActive = true 的規則
 *   - 驗證邏輯與 workers 相同（@open333crm/automation 的 validateAutomationRuleContract）
 *   - 只寫 isActive = false 與 updatedAt；trigger、conditions、actions 保留原樣
 *   - 預設 dry-run，帶 --apply 才寫入；可重複執行（第二次執行時沒有符合的規則）
 *   - 所有租戶一起處理。automation_rules 開了 FORCE RLS，要用 owner 或 BYPASSRLS 的連線：
 *     有 MIGRATE_DATABASE_URL 時優先使用，否則用 DATABASE_URL
 *
 * 用法（在 repo 根目錄，或把腳本複製到 API 容器的 /app/scripts/ 後在 /app）：
 *   node scripts/disable-invalid-automation-rules.mjs          # dry-run，列出會停用的規則與原因
 *   node scripts/disable-invalid-automation-rules.mjs --apply  # 實際停用
 *
 * 回滾：輸出的規則 ID 清單可用來把 isActive 改回 true（但規則仍不會執行，直到修正內容）。
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 套件裝在 apps/api 底下（repo 與 API 容器都有）；根目錄沒有這兩個相依。
// 這支腳本要放在 <repo 或 /app>/scripts/ 底下執行
const apiPackageJson = new URL('../apps/api/package.json', import.meta.url);
if (!existsSync(apiPackageJson)) {
  console.error('找不到 apps/api/package.json：請把腳本放在 repo（或 API 容器 /app）的 scripts/ 底下執行');
  process.exit(1);
}
const requireFromApi = createRequire(apiPackageJson);
const { PrismaClient } = requireFromApi('@prisma/client');
const { validateAutomationRuleContract } = await import(
  pathToFileURL(requireFromApi.resolve('@open333crm/automation')).href
);

const apply = process.argv.includes('--apply');
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('請設定 MIGRATE_DATABASE_URL 或 DATABASE_URL');
  process.exit(1);
}
const prisma = new PrismaClient({ datasourceUrl: url });

/** 與 workers 相同：觸發事件以 trigger.type 為準，eventType 為後備 */
function eventNameOf(rule) {
  const trigger = rule.trigger && typeof rule.trigger === 'object' ? rule.trigger : {};
  return (typeof trigger.type === 'string' && trigger.type) || rule.eventType || 'message.received';
}

try {
  const rules = await prisma.automationRule.findMany({
    where: { enabled: true, isActive: true },
    select: {
      id: true,
      tenantId: true,
      name: true,
      eventType: true,
      trigger: true,
      conditions: true,
      actions: true,
      tenant: { select: { name: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });

  const targets = [];
  for (const rule of rules) {
    const result = validateAutomationRuleContract({
      eventName: eventNameOf(rule),
      conditions: rule.conditions,
      actions: rule.actions,
    });
    if (!result.valid) targets.push({ rule, errors: result.errors });
  }

  console.log(`啟用中的規則 ${rules.length} 條，其中不合契約、workers 不會執行的有 ${targets.length} 條：`);
  for (const { rule, errors } of targets) {
    console.log(`  - [${rule.tenant?.name ?? rule.tenantId}] ${rule.name}（${rule.id}）`);
    for (const e of errors) console.log(`      ${e}`);
  }

  if (targets.length === 0) {
    console.log('沒有需要處理的規則。');
  } else if (!apply) {
    console.log('\n[dry-run] 未寫入。確認清單後加 --apply 實際停用。');
  } else {
    const result = await prisma.automationRule.updateMany({
      // 再次限定 isActive = true：dry-run 與 --apply 之間被管理員改過的規則不重複處理
      where: { id: { in: targets.map((t) => t.rule.id) }, enabled: true, isActive: true },
      data: { isActive: false },
    });
    console.log(`\n已停用 ${result.count} 條規則，內容保留原樣。`);
    console.log(`規則 ID：${targets.map((t) => t.rule.id).join(',')}`);
  }
} finally {
  await prisma.$disconnect();
}
