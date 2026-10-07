#!/usr/bin/env node
/**
 * validate-openspec.mjs
 *
 * 以 repo 固定版本的 openspec 執行 `validate --strict`，但略過主規格「需求內文超過 500 字元」的警告。
 *
 * openspec 1.14.1 把超過 500 字元的需求列為 WARNING，`--strict` 遇到任何 WARNING 都失敗。
 * 主規格目前有多條需求超過這個長度，拆開之前 `--strict` 一定失敗，其他問題也就被淹沒。
 * 這支腳本只放過主規格的這一種警告，其他 ERROR 與 WARNING 照常讓檢查失敗。
 * change 的這則警告不放過：openspec 只對 ADDED 的需求檢查長度，也就是新寫的需求，
 * 新寫的需求要拆短，不要再增加過長的需求。
 * 主規格過長的需求全部拆開後，刪除這支腳本，改回直接執行 `pnpm exec openspec validate --strict`。
 *
 * 用法（參數原樣交給 `openspec validate`）：
 *   node scripts/validate-openspec.mjs --specs          # 所有主規格
 *   node scripts/validate-openspec.mjs --changes        # 所有進行中的 change
 *   node scripts/validate-openspec.mjs <change-name>    # 單一 change
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath：路徑含空白或非 ASCII 字元時，URL.pathname 會是百分比編碼
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OPENSPEC = join(ROOT, 'node_modules/.bin/openspec');

// openspec 的 REQUIREMENT_TOO_LONG 訊息。ADDED 的版本前面多了 `ADDED "<名稱>": `
const TOO_LONG = 'Requirement text is very long (>';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法：node scripts/validate-openspec.mjs --specs | --changes | --all | <name>');
  process.exit(2);
}

const run = spawnSync(OPENSPEC, ['validate', ...args, '--strict', '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  // 參數錯誤、找不到項目或沒安裝依賴時，openspec 不輸出 JSON
  console.error('❌ openspec 沒有輸出 JSON 報告：');
  console.error((run.stderr || run.stdout || run.error?.message || '').trim());
  process.exit(1);
}

// 找不到項目等指令層級的錯誤，openspec 以 `status` 回報，不會有 `items`
if (!Array.isArray(report.items) || report.items.length === 0) {
  console.error('❌ openspec 沒有驗證任何項目：');
  for (const s of report.status ?? []) console.error(`  [${s.severity}] ${s.message}`);
  process.exit(1);
}

let ignored = 0;
const failures = [];
for (const item of report.items) {
  const remaining = (item.issues ?? []).filter((issue) => {
    if (item.type === 'spec' && issue.level === 'WARNING' && issue.message.includes(TOO_LONG)) {
      ignored++;
      return false;
    }
    return issue.level === 'ERROR' || issue.level === 'WARNING';
  });
  if (remaining.length) failures.push({ item, remaining });
}

const total = report.items.length;
if (failures.length === 0) {
  console.log(`✅ openspec validate --strict：${total} 項通過（略過 ${ignored} 則需求過長的警告）。`);
  process.exit(0);
}

console.error(`❌ openspec validate --strict：${failures.length} 項未通過（共 ${total} 項，另略過 ${ignored} 則需求過長的警告）：`);
for (const { item, remaining } of failures) {
  console.error(`\n✗ ${item.type}/${item.id}`);
  for (const issue of remaining) console.error(`  [${issue.level}] ${issue.path ? `${issue.path}: ` : ''}${issue.message}`);
}
process.exit(1);
