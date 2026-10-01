/**
 * 必填字串欄位的 trim 驗證。
 *   npx tsx src/__tests__/trim-validation.test.ts
 *
 * 背景（Wave 6 欄位級測試）：
 * `z.string().min(1)` 不會 trim，所以純空白 '   ' 與全形空白 '　' 長度都 >= 1，
 * 驗證直接放行。前端多半用 `!form.name` 判斷，純空白同樣被當成「有值」而解鎖按鈕。
 *
 * 結果是資料庫裡出現一批「看起來沒有名字」的資料：
 * 活動、分群、廣播、素材、分類、標籤、工單標題、聯繫人、知識庫文章、自動化規則。
 * 其中 Rich Menu 的 chatBarText 最嚴重——那是 LINE 選單列上真實可見的按鈕文字，
 * 純空白會在使用者的 LINE 裡顯示成一塊空白按鈕。
 *
 * 驗的是「純空白進不了資料庫」以及「合法值不被誤殺」。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

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

/** 空白樣本：半形、全形、tab、換行、混合 */
const BLANKS = ['   ', '　', '\t', '\n', ' 　\t '];

// ─── 先確認「為什麼這是 bug」的前提 ────────────────────────────────────────

t('前提：min(1) 不 trim，純空白與全形空白都會通過', () => {
  const loose = z.string().min(1);
  for (const blank of BLANKS) {
    assert.strictEqual(loose.safeParse(blank).success, true, `min(1) 放行了 ${JSON.stringify(blank)}`);
  }
});

t('前提：前端常見的 !value 判斷也把純空白當成有值', () => {
  for (const blank of BLANKS) {
    assert.strictEqual(!blank, false, `!${JSON.stringify(blank)} 應為 false（即被當成有值）`);
  }
});

// ─── trim().min(1) 的行為 ─────────────────────────────────────────────────

const strict = z.string().trim().min(1);

t('trim().min(1) 擋下所有空白樣本', () => {
  for (const blank of BLANKS) {
    assert.strictEqual(strict.safeParse(blank).success, false, `未擋下 ${JSON.stringify(blank)}`);
  }
});

t('trim().min(1) 不誤殺合法值', () => {
  for (const good of ['你好', 'a', '中文 含空格', '123']) {
    assert.strictEqual(strict.safeParse(good).success, true, `誤殺了 ${good}`);
  }
});

t('trim() 會去掉前後空白但保留中間內容（不破壞既有資料語意）', () => {
  const r = strict.safeParse('  中間 有 空格  ');
  assert.strictEqual(r.success, true);
  if (r.success) assert.strictEqual(r.data, '中間 有 空格');
});

t('trim 後的長度上限以 trim 後的值計算', () => {
  const capped = z.string().trim().min(1).max(5);
  // 前後空白不應佔用長度額度
  assert.strictEqual(capped.safeParse('  abc  ').success, true);
  assert.strictEqual(capped.safeParse('abcdef').success, false);
});

// ─── 回歸防護：確認各模組真的套用了 ───────────────────────────────────────

/** 檔案 → 必須含 trim() 的欄位關鍵字 */
const TARGETS: Array<[string, string[]]> = [
  ['modules/marketing/marketing.routes.ts', ['name']],
  ['modules/marketing/material.routes.ts', ['name']],
  ['modules/case/case.routes.ts', ['title', 'reason', 'content']],
  ['modules/contact/contact.routes.ts', ['displayName']],
  ['modules/knowledge/knowledge.routes.ts', ['title']],
  ['modules/automation/automation.routes.ts', ['name']],
  ['modules/tag/tag.routes.ts', ['name']],
  ['modules/agent/agent.schema.ts', ['name']],
  ['modules/line/rich-menu.routes.ts', ['chatBarText']],
];

for (const [rel, fields] of TARGETS) {
  t(`${rel.split('/').pop()} 的必填名稱欄位已加 trim`, () => {
    const code = src(rel);
    for (const field of fields) {
      // 不得再出現「該欄位 + min(1) 但沒有 trim」的組合
      const bad = new RegExp(`${field}:\\s*z\\.string\\(\\)\\.min\\(1`);
      assert.ok(
        !bad.test(code),
        `${rel} 的 ${field} 仍是 z.string().min(1)（未 trim），純空白可寫入`,
      );
    }
  });
}

t('chatBarText 有 trim（LINE 選單列真實可見的按鈕文字）', () => {
  const code = src('modules/line/rich-menu.routes.ts');
  assert.ok(
    code.includes("chatBarText: z.string().trim().min(1"),
    'chatBarText 未 trim，純空白會在使用者的 LINE 顯示成空白按鈕',
  );
});

t('原本沒有長度上限的欄位已補上（Wave 6 實測可存超長值）', () => {
  // 取「欄位名 → 該行結尾」整行來看有無 .max(——
  // 不能用 [^,]* 截斷，因為 min(1, '訊息') 的錯誤訊息本身就含逗號。
  const lineOf = (code: string, field: string): string => {
    const line = code.split('\n').find((l) => new RegExp(`^\\s*${field}:\\s*z\\.string\\(\\)`).test(l));
    assert.ok(line, `找不到 ${field} 的定義`);
    return line as string;
  };

  const caseCode = src('modules/case/case.routes.ts');
  assert.ok(lineOf(caseCode, 'reason').includes('.max('), 'escalate reason 仍無長度上限（實測 10000 字可寫入）');
  assert.ok(lineOf(caseCode, 'content').includes('.max('), '工單備註 content 仍無長度上限（實測 50000 字可寫入）');

  const tagCode = src('modules/tag/tag.routes.ts');
  assert.ok(lineOf(tagCode, 'name').includes('.max('), '標籤 name 仍無長度上限（實測 500 字可寫入）');

  const contactCode = src('modules/contact/contact.routes.ts');
  assert.ok(
    lineOf(contactCode, 'displayName').includes('.max('),
    '聯繫人 displayName 仍無長度上限（實測 10000 字可寫入）',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
