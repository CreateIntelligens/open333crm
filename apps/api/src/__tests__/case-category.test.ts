/**
 * 工單分類的單一事實來源驗證。
 *   npx tsx src/__tests__/case-category.test.ts
 *
 * 背景（Wave 6 欄位級測試）：
 * 工單分類原本散在四個地方各寫一份，而且內容不一致——
 *   1. CaseCreateModal.tsx      維修 / 查詢 / 投訴 / 其他
 *   2. cases/page.tsx（篩選）    同上
 *   3. CaseDetail.tsx（詳情頁）  產品諮詢 / 訂單問題 / …共 9 項
 *   4. case.routes.ts（API）     維修 / 查詢 / 投訴 / 其他
 * 前三者只有「其他」重疊。
 *
 * 後果：用建立視窗選「維修」的工單，進詳情頁時分類下拉找不到對應 option
 * 會顯示成空值，使用者只要存一次檔分類就被洗掉。
 *
 * 加上後端 category 原本是 `z.string()` 全開，實測 500 字亂碼與
 * `<script>` 都能寫入，會污染分類篩選下拉與報表版面。
 *
 * 2026-09-23 決議統一採詳情頁那套 9 項，抽到 @open333crm/shared。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CASE_CATEGORIES, CASE_CATEGORY_OPTIONS, isValidCaseCategory } from '@open333crm/shared';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const webSrc = (rel: string) =>
  readFileSync(join(here, '../../../../apps/web/src', rel), 'utf8');

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

/** 統一前的舊清單——不該再出現在任何地方 */
const LEGACY_CATEGORIES = ['維修', '查詢', '投訴'];

// ─── 常數本身 ─────────────────────────────────────────────────────────────

t('採用決議的 9 項分類', () => {
  assert.deepStrictEqual([...CASE_CATEGORIES], [
    '產品諮詢',
    '訂單問題',
    '退換貨',
    '帳號問題',
    '技術支援',
    '投訴建議',
    '付款問題',
    '物流配送',
    '其他',
  ]);
});

t('下拉選項含「未分類」空值（詳情頁可清空分類）', () => {
  assert.strictEqual(CASE_CATEGORY_OPTIONS[0].value, '');
  assert.strictEqual(CASE_CATEGORY_OPTIONS[0].label, '未分類');
  assert.strictEqual(CASE_CATEGORY_OPTIONS.length, CASE_CATEGORIES.length + 1);
});

t('isValidCaseCategory 接受合法分類與空值', () => {
  for (const c of CASE_CATEGORIES) {
    assert.strictEqual(isValidCaseCategory(c), true, `${c} 應合法`);
  }
  assert.strictEqual(isValidCaseCategory(''), true, '空字串＝未分類，應合法');
  assert.strictEqual(isValidCaseCategory(null), true);
  assert.strictEqual(isValidCaseCategory(undefined), true);
});

t('isValidCaseCategory 擋下亂碼與注入樣本', () => {
  for (const bad of ['<script>alert(1)</script>', 'a'.repeat(500), '不存在的分類', 123, {}]) {
    assert.strictEqual(isValidCaseCategory(bad), false, `${String(bad).slice(0, 20)} 應被擋下`);
  }
});

t('舊清單的專有項目已不在新清單內（確認這確實是一次替換）', () => {
  for (const legacy of LEGACY_CATEGORIES) {
    assert.ok(
      !(CASE_CATEGORIES as readonly string[]).includes(legacy),
      `舊分類「${legacy}」不該出現在新清單`,
    );
  }
});

// ─── 回歸防護：四個地方都要改用共用常數 ──────────────────────────────────

t('後端 case.routes.ts 用共用常數，且移除了本地重複定義', () => {
  const code = apiSrc('modules/case/case.routes.ts');
  assert.ok(code.includes("from '@open333crm/shared'"), '未從 shared 匯入');
  assert.ok(code.includes('CASE_CATEGORIES'), '未使用 CASE_CATEGORIES');
  assert.ok(
    !/const CASE_CATEGORIES = \[/.test(code),
    'case.routes.ts 仍有本地的 CASE_CATEGORIES 定義（這是第 4 套清單）',
  );
});

t('後端寫入端點用 enum 擋非法分類（原本 z.string() 全開）', () => {
  const code = apiSrc('modules/case/case.routes.ts');
  assert.ok(code.includes('caseCategorySchema'), '未定義 caseCategorySchema');
  assert.ok(
    code.includes('category: caseCategorySchema.optional()'),
    '寫入端點未套用 caseCategorySchema',
  );
});

t('前端三處都改用共用常數', () => {
  const files: Array<[string, string]> = [
    ['components/case/CaseCreateModal.tsx', 'CASE_CATEGORIES'],
    ['components/case/CaseDetail.tsx', 'CASE_CATEGORY_OPTIONS'],
    ['app/dashboard/cases/page.tsx', 'CASE_CATEGORIES'],
  ];
  for (const [rel, symbol] of files) {
    const code = webSrc(rel);
    assert.ok(code.includes("from '@open333crm/shared'"), `${rel} 未從 shared 匯入`);
    assert.ok(code.includes(symbol), `${rel} 未使用 ${symbol}`);
  }
});

t('前端不再出現寫死的舊分類字面量', () => {
  const files = [
    'components/case/CaseCreateModal.tsx',
    'components/case/CaseDetail.tsx',
    'app/dashboard/cases/page.tsx',
  ];
  for (const rel of files) {
    const code = webSrc(rel);
    for (const legacy of LEGACY_CATEGORIES) {
      assert.ok(
        !code.includes(`value: '${legacy}'`),
        `${rel} 仍有寫死的舊分類「${legacy}」`,
      );
    }
  }
});

t('關鍵不變式：建立頁能選的分類，詳情頁都必須能顯示', () => {
  // 這正是原本的 bug——建立頁選「維修」，詳情頁沒有該 option 而顯示空值，
  // 使用者一存檔分類就被洗掉。
  const detailValues = CASE_CATEGORY_OPTIONS.map((o) => o.value);
  for (const c of CASE_CATEGORIES) {
    assert.ok(
      detailValues.includes(c),
      `建立頁的「${c}」在詳情頁下拉找不到，存檔會把分類洗掉`,
    );
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
