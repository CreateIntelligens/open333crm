/**
 * 分頁參數夾制的行為驗證。
 *   npx tsx src/__tests__/pagination.test.ts
 *
 * 背景：service 層普遍用 `skip: (page - 1) * limit`，page < 1 會算出負 skip，
 * Prisma 直接拒收並拋出未攔截例外 → 500。
 * UAT 實測（Wave 6）：marketing/materials、marketing/campaigns、
 * marketing/segments、shortlinks、portal/activities 五個端點
 * `?page=0` 與 `?page=-1` 皆回 500；`?page=abc` 則正確回 400。
 *
 * 驗的是「負 skip 不可能算得出來」，不是字串長相。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clampPage, clampLimit, paginationSchema, MAX_PAGE_SIZE } from '../shared/utils/pagination.js';

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

// ─── clampPage：任何輸入都不得產生 < 1 的頁碼 ──────────────────────────────

t('clampPage 把 0 夾到 1（UAT 實測回 500 的主因）', () => {
  assert.strictEqual(clampPage(0), 1);
});

t('clampPage 把負數夾到 1', () => {
  assert.strictEqual(clampPage(-1), 1);
  assert.strictEqual(clampPage(-99), 1);
});

t('clampPage 保留合法頁碼', () => {
  assert.strictEqual(clampPage(1), 1);
  assert.strictEqual(clampPage(5), 5);
});

t('clampPage 無條件捨去小數（避免 Prisma 收到非整數 skip）', () => {
  assert.strictEqual(clampPage(1.7), 1);
  assert.strictEqual(clampPage(2.9), 2);
});

t('clampPage 對 undefined / NaN 回預設 1', () => {
  assert.strictEqual(clampPage(undefined), 1);
  assert.strictEqual(clampPage(NaN), 1);
});

t('關鍵不變式：clampPage 的結果代入 skip 公式永不為負', () => {
  for (const input of [0, -1, -999, 1.5, NaN, undefined, 3]) {
    const skip = (clampPage(input as number) - 1) * 50;
    assert.ok(skip >= 0, `skip=${skip} 由 page=${String(input)} 算出，不應為負`);
  }
});

// ─── clampLimit ────────────────────────────────────────────────────────────

t('clampLimit 把 0 與負數夾到 1', () => {
  assert.strictEqual(clampLimit(0), 1);
  assert.strictEqual(clampLimit(-5), 1);
});

t('clampLimit 設上限，避免一次撈爆回應體積', () => {
  assert.strictEqual(clampLimit(999), MAX_PAGE_SIZE);
});

t('clampLimit 尊重呼叫端的預設值', () => {
  assert.strictEqual(clampLimit(undefined, 50), 50);
  assert.strictEqual(clampLimit(20), 20);
});

// ─── paginationSchema：route 層的第一道防線 ────────────────────────────────

t('paginationSchema 擋下 page=0 / page=-1（回 400 而非 500）', () => {
  assert.strictEqual(paginationSchema.safeParse({ page: '0' }).success, false);
  assert.strictEqual(paginationSchema.safeParse({ page: '-1' }).success, false);
});

t('paginationSchema 擋下非數字頁碼', () => {
  assert.strictEqual(paginationSchema.safeParse({ page: 'abc' }).success, false);
});

t('paginationSchema 擋下超出上限的 limit', () => {
  assert.strictEqual(paginationSchema.safeParse({ limit: '500' }).success, false);
});

t('paginationSchema 接受合法值並帶入預設', () => {
  const r = paginationSchema.safeParse({ page: '2' });
  assert.strictEqual(r.success, true);
  if (r.success) {
    assert.strictEqual(r.data.page, 2);
    assert.strictEqual(r.data.limit, 20);
  }
});

t('paginationSchema 全空時給預設值（query string 常見情境）', () => {
  const r = paginationSchema.safeParse({});
  assert.strictEqual(r.success, true);
  if (r.success) assert.strictEqual(r.data.page, 1);
});

// ─── 回歸防護：確認受害端點真的接上夾制 ────────────────────────────────────

t('UAT 實測回 500 的五個端點都已接上夾制', () => {
  const targets: Array<[string, string]> = [
    ['modules/marketing/material.routes.ts', 'materials'],
    ['modules/marketing/marketing.routes.ts', 'campaigns/segments/broadcasts'],
    ['modules/portal/portal.routes.ts', 'portal activities'],
  ];
  for (const [rel, label] of targets) {
    const code = src(rel);
    assert.ok(
      code.includes('clampPage('),
      `${label}（${rel}）未接上 clampPage，page=0 仍會回 500`,
    );
  }
});

t('短連結改用 zod 擋分頁（不是裸 parseInt）', () => {
  const code = src('modules/shortlink/shortlink.routes.ts');
  assert.ok(
    code.includes('z.coerce.number().int().positive()'),
    'shortlink.routes.ts 的分頁未用 zod positive 擋下',
  );
  assert.ok(
    !code.includes('page ? parseInt(page)'),
    'shortlink.routes.ts 仍殘留未夾制的 parseInt',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
