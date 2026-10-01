/**
 * keyword.matched 觸發條件的驗證。
 *   npx tsx src/__tests__/keyword-trigger-validation.test.ts
 *
 * 背景（Wave 6 欄位級測試發現）：
 * automation.routes.ts 原本的 trigger 只有 `z.object({ type }).passthrough()`，
 * keywords 完全不驗。而 automation.worker.ts 的比對是
 * `lowerText.includes(kw.toLowerCase())` —— `includes('')` 在 JS 恆為 true。
 *
 * worker 雖有 `if (keywords.length === 0) continue` 防空陣列，但擋不住
 * `['']`（長度為 1），結果是該規則會對租戶內每一則進來的訊息觸發自動回覆。
 * API 直呼建立這種規則原本回 201。
 *
 * 本測試驗的是「危險的 keywords 組合進不了資料庫」。
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

// ─── 先驗證「為什麼這是 bug」的前提仍然成立 ────────────────────────────────

t('前提：JS 的 includes("") 恆為 true（這是漏洞的成因）', () => {
  assert.strictEqual('任意訊息'.toLowerCase().includes(''), true);
  assert.strictEqual(''.includes(''), true);
});

t('前提：worker 的 length===0 防護擋不住 [""]（長度為 1）', () => {
  const keywords = [''];
  assert.strictEqual(keywords.length === 0, false, 'length 防護會放行 [""]');
  const wouldMatch = keywords.some((kw) => '任意訊息'.toLowerCase().includes(kw.toLowerCase()));
  assert.strictEqual(wouldMatch, true, '確認 [""] 會命中任意訊息');
});

// ─── 重建 route 的 schema 來驗證擋控 ──────────────────────────────────────
// （route 檔未 export schema，此處以相同定義驗證行為；
//   下方另有「原始碼確實套用」的回歸檢查。）

const keywordTriggerSchema = z.object({
  type: z.literal('keyword.matched'),
  keywords: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50),
  match_mode: z.enum(['any', 'all']).optional(),
});

const reject = (payload: unknown, why: string) => {
  const r = keywordTriggerSchema.safeParse(payload);
  assert.strictEqual(r.success, false, why);
};

t('擋下 keywords: [""]（最高風險：會對每則訊息亂回覆）', () => {
  reject({ type: 'keyword.matched', keywords: [''] }, '空字串關鍵字應被擋下');
});

t('擋下 keywords: ["   "]（trim 後為空，等同空字串）', () => {
  reject({ type: 'keyword.matched', keywords: ['   '] }, '純空白關鍵字應被擋下');
});

t('擋下全形空白關鍵字', () => {
  reject({ type: 'keyword.matched', keywords: ['　'] }, '全形空白應被擋下');
});

t('擋下 keywords: []（規則永遠不會觸發，屬沉默失效）', () => {
  reject({ type: 'keyword.matched', keywords: [] }, '空陣列應被擋下');
});

t('擋下超長關鍵字（>100 字）', () => {
  reject({ type: 'keyword.matched', keywords: ['a'.repeat(101)] }, '101 字應被擋下');
});

t('擋下非法 match_mode', () => {
  reject(
    { type: 'keyword.matched', keywords: ['你好'], match_mode: 'BOGUS_MODE' },
    '非列舉的 match_mode 應被擋下',
  );
});

t('擋下混入空字串的陣列（合法關鍵字不能當掩護）', () => {
  reject({ type: 'keyword.matched', keywords: ['你好', ''] }, '陣列內任一空字串都應被擋下');
});

t('接受合法關鍵字並自動 trim', () => {
  const r = keywordTriggerSchema.safeParse({
    type: 'keyword.matched',
    keywords: ['  你好  ', '報價'],
    match_mode: 'any',
  });
  assert.strictEqual(r.success, true);
  if (r.success) assert.deepStrictEqual(r.data.keywords, ['你好', '報價']);
});

t('接受 100 字邊界值（不可誤殺）', () => {
  const r = keywordTriggerSchema.safeParse({
    type: 'keyword.matched',
    keywords: ['a'.repeat(100)],
  });
  assert.strictEqual(r.success, true, '剛好 100 字應通過');
});

t('關鍵不變式：通過驗證的 keywords 不可能命中任意訊息', () => {
  const samples = [
    ['你好'],
    ['報價', '價格'],
    ['a'.repeat(100)],
  ];
  for (const keywords of samples) {
    const r = keywordTriggerSchema.safeParse({ type: 'keyword.matched', keywords });
    assert.strictEqual(r.success, true);
    if (!r.success) continue;
    // 用一則絕不含上述關鍵字的訊息驗證：不應命中
    const unrelated = 'zzz-unrelated-message-zzz';
    const matched = r.data.keywords.some((kw) => unrelated.toLowerCase().includes(kw.toLowerCase()));
    assert.strictEqual(matched, false, `keywords=${JSON.stringify(keywords)} 不應命中無關訊息`);
  }
});

// ─── 回歸防護：確認 route 真的套用了 ──────────────────────────────────────

t('automation.routes.ts 確實定義並套用 keywordTriggerSchema', () => {
  const code = src('modules/automation/automation.routes.ts');
  assert.ok(code.includes('keywordTriggerSchema'), '未定義 keywordTriggerSchema');
  assert.ok(
    code.includes('trigger: triggerSchema'),
    'createRuleSchema 未套用 triggerSchema',
  );
  assert.ok(
    code.includes('triggerSchema.optional()'),
    'updateRuleSchema 未套用 triggerSchema（可先建合法規則再改成 [""] 繞過）',
  );
});

t('automation.routes.ts 不再有裸 passthrough 的 trigger', () => {
  const code = src('modules/automation/automation.routes.ts');
  assert.ok(
    !/trigger:\s*z\s*\n?\s*\.object\(\{\s*\n?\s*type:\s*z\.string\(\)\.min\(1\),\s*\n?\s*\}\)\s*\n?\s*\.passthrough\(\)/.test(code),
    '仍殘留未經 superRefine 的 passthrough trigger',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
