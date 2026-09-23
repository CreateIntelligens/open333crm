/**
 * 自動化規則「刪除」與「手動停用」的分離。
 *   npx tsx src/__tests__/automation-soft-delete.test.ts
 *
 * 背景（CM-170，Wave 6 複驗仍在）：
 * deleteRule 原本只把 `isActive` 設 false，而列表查詢不過濾軟刪資料，
 * 導致刪掉的規則仍顯示在後台。UAT 實測累積 119 筆 [E2E] 測試殘留
 * （總規則 155、已停用 152）全部列在畫面上。
 *
 * 不能單純「列表過濾 isActive=false」了事——畫面上有啟用切換開關，
 * 使用者手動停用的規則本來就該留在列表裡。兩件事共用同一個欄位才是根因。
 *
 * 修法：用 `enabled` 欄位標記「已刪除」，isActive 維持「使用者的啟用狀態」。
 * enabled 原本幾乎沒被使用（worker 的觸發判斷只看 isActive），可安全挪用。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const repoFile = (rel: string) => readFileSync(join(here, '../../../../', rel), 'utf8');

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(err as Error).message}`);
    fail += 1;
  }
}

const service = src('modules/automation/automation.service.ts');

// ─── 刪除語意 ─────────────────────────────────────────────────────────────

t('deleteRule 用 enabled 標記已刪除，不只關 isActive', () => {
  const deleteBlock = service.slice(service.indexOf('export async function deleteRule'));
  assert.ok(
    /data:\s*\{\s*enabled:\s*false/.test(deleteBlock),
    'deleteRule 未設 enabled=false——刪除與手動停用仍共用 isActive，列表無法區分',
  );
});

t('刪除同時關掉 isActive（停止觸發）', () => {
  const deleteBlock = service.slice(service.indexOf('export async function deleteRule'));
  assert.ok(
    /enabled:\s*false,\s*isActive:\s*false/.test(deleteBlock),
    '刪除後應同時停止觸發，否則規則還會繼續跑',
  );
});

// ─── 列表與單筆查詢都要排除已刪除 ────────────────────────────────────────

t('列表查詢排除已刪除的規則', () => {
  const listBlock = service.slice(
    service.indexOf('export async function listRules'),
    service.indexOf('export async function getRule'),
  );
  assert.ok(
    /WhereInput\s*=\s*\{\s*tenantId,\s*enabled:\s*true\s*\}/.test(listBlock),
    'listRules 未排除 enabled=false——刪掉的規則仍會顯示在後台',
  );
});

t('列表仍會顯示「使用者手動停用」的規則', () => {
  const listBlock = service.slice(
    service.indexOf('export async function listRules'),
    service.indexOf('export async function getRule'),
  );
  // isActive 只在呼叫端明確帶 filters.isActive 時才進 where，
  // 不可寫死成 isActive: true，否則手動停用的規則會消失
  assert.ok(
    !/WhereInput\s*=\s*\{[^}]*isActive:\s*true/.test(listBlock),
    'listRules 不該寫死 isActive:true——使用者手動停用的規則會從列表消失',
  );
  assert.ok(
    /if\s*\(filters\.isActive\s*!==\s*undefined\)/.test(listBlock),
    'isActive 應維持由呼叫端過濾',
  );
});

t('單筆查詢也排除已刪除（否則刪掉的規則仍可用網址開啟）', () => {
  const getBlock = service.slice(
    service.indexOf('export async function getRule'),
    service.indexOf('export async function createRule'),
  );
  assert.ok(
    /where:\s*\{\s*id,\s*tenantId,\s*enabled:\s*true\s*\}/.test(getBlock),
    'getRule 未排除 enabled=false',
  );
});

// ─── worker 的觸發判斷不受影響 ───────────────────────────────────────────

t('worker 仍以 isActive 判斷是否觸發（行為未改變）', () => {
  const worker = src('modules/automation/automation.worker.ts');
  assert.ok(
    worker.includes('isActive: true'),
    'worker 的觸發判斷應維持看 isActive',
  );
});

t('刪除後 isActive 也是 false，所以 worker 不會撿到已刪除的規則', () => {
  // 這是上面兩個斷言合起來的不變式：
  // deleteRule 同時設 enabled=false 與 isActive=false，
  // worker 只看 isActive=true，因此已刪除的規則不會被觸發。
  const deleteBlock = service.slice(service.indexOf('export async function deleteRule'));
  assert.ok(/isActive:\s*false/.test(deleteBlock));
});

// ─── 既有資料的回填腳本 ───────────────────────────────────────────────────

t('有回填腳本可處理既有殘留資料', () => {
  const script = repoFile('scripts/cleanup-e2e-automation-rules.mjs');
  assert.ok(script.includes('enabled: false'), '腳本未標記 enabled=false');
  assert.ok(
    script.includes("contains: '[E2E]'"),
    '腳本未限定 [E2E] 前綴——可能誤刪正式資料',
  );
  assert.ok(
    script.includes('isActive: false'),
    '腳本未限定已停用的規則——可能誤刪運作中的規則',
  );
  assert.ok(
    script.includes("includes('--apply')"),
    '腳本未提供 dry-run，直接執行有誤刪風險',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
