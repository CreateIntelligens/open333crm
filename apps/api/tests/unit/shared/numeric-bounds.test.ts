/**
 * 數值欄位邊界驗證。
 *   npx tsx src/__tests__/numeric-bounds.test.ts
 *
 * 背景（Wave 6 欄位級測試）：
 * Prisma 的 `Int` 對應 PostgreSQL int4（-2147483648 ~ 2147483647）。
 * zod 的 `.int()` 只檢查「是不是整數」，不檢查「放不放得進 int4」，
 * 超出範圍的值會一路送到 Prisma，由資料庫拒收並拋未攔截例外 → 500。
 *
 * UAT 實測：
 * - POST /sla-policies 帶 firstResponseMinutes: 2147483648 → 500
 *   （2147483647 可正常存入，確認就是 int4 邊界）
 * - POST /portal/points/adjust 帶 amount: 999999999999999 → 500
 * - amount: 1.5 被靜默無條件捨去成 1（帳務性操作上不可接受）
 *
 * 正確行為是回 400 並說明上限，而不是 500 或默默改掉使用者輸入的數字。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  int4Schema,
  positiveInt4Schema,
  slaMinutesSchema,
  INT4_MAX,
  INT4_MIN,
  MAX_SLA_MINUTES,
} from '../shared/utils/numeric-bounds.js';

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

// ─── 前提：確認 int4 邊界就是 UAT 觀察到的那條線 ──────────────────────────

t('前提：INT4_MAX 正是 UAT 實測可存入的最大值', () => {
  assert.strictEqual(INT4_MAX, 2_147_483_647);
  assert.strictEqual(INT4_MIN, -2_147_483_648);
});

// ─── int4Schema：允許負數（扣點），只擋溢位 ───────────────────────────────

t('int4Schema 擋下 UAT 實測造成 500 的值', () => {
  assert.strictEqual(int4Schema.safeParse(999_999_999_999_999).success, false);
  assert.strictEqual(int4Schema.safeParse(INT4_MAX + 1).success, false, '上限+1 應被擋下');
  assert.strictEqual(int4Schema.safeParse(INT4_MIN - 1).success, false, '下限-1 應被擋下');
});

t('int4Schema 接受邊界值本身（不可誤殺）', () => {
  assert.strictEqual(int4Schema.safeParse(INT4_MAX).success, true);
  assert.strictEqual(int4Schema.safeParse(INT4_MIN).success, true);
});

t('int4Schema 允許負數與 0（積分可以扣點）', () => {
  assert.strictEqual(int4Schema.safeParse(-100).success, true);
  assert.strictEqual(int4Schema.safeParse(0).success, true);
});

t('int4Schema 擋下小數（不靜默捨去）', () => {
  // UAT 實測 1.5 被 Prisma 無條件捨去成 1，使用者完全無感知。
  // 帳務性操作上寧可回 400 要求使用者自己決定，也不替他四捨五入。
  assert.strictEqual(int4Schema.safeParse(1.5).success, false);
  assert.strictEqual(int4Schema.safeParse(-2.7).success, false);
});

t('int4Schema 擋下非數字與特殊值', () => {
  for (const bad of ['100', null, undefined, {}, NaN, Infinity, -Infinity]) {
    assert.strictEqual(int4Schema.safeParse(bad).success, false, `${String(bad)} 應被擋下`);
  }
});

// ─── positiveInt4Schema ───────────────────────────────────────────────────

t('positiveInt4Schema 擋下 0 與負數', () => {
  assert.strictEqual(positiveInt4Schema.safeParse(0).success, false);
  assert.strictEqual(positiveInt4Schema.safeParse(-1).success, false);
  assert.strictEqual(positiveInt4Schema.safeParse(1).success, true);
});

// ─── slaMinutesSchema：上限刻意小於 int4 ──────────────────────────────────

t('slaMinutesSchema 擋下 UAT 實測造成 500 的 2147483648', () => {
  assert.strictEqual(slaMinutesSchema.safeParse(2_147_483_648).success, false);
});

t('slaMinutesSchema 的上限是「語意合理」而非 int4 上限', () => {
  // 2147483647 分鐘約 4083 年，型別上放得進去但語意毫無意義，
  // 在明顯不合理處就擋下並給可理解的訊息。
  assert.strictEqual(slaMinutesSchema.safeParse(INT4_MAX).success, false, 'int4 上限在 SLA 語意上不合理');
  assert.strictEqual(MAX_SLA_MINUTES, 525_600, '365 天');
  assert.strictEqual(slaMinutesSchema.safeParse(MAX_SLA_MINUTES).success, true, '365 天應可設定');
  assert.strictEqual(slaMinutesSchema.safeParse(MAX_SLA_MINUTES + 1).success, false);
});

t('slaMinutesSchema 接受常見的 SLA 設定值', () => {
  for (const good of [15, 30, 60, 240, 1440, 10080]) {
    assert.strictEqual(slaMinutesSchema.safeParse(good).success, true, `${good} 分鐘應可設定`);
  }
});

t('slaMinutesSchema 擋下 0、負數與小數', () => {
  for (const bad of [0, -1, 1.5]) {
    assert.strictEqual(slaMinutesSchema.safeParse(bad).success, false, `${bad} 應被擋下`);
  }
});

// ─── 回歸防護：確認受害端點真的套用了 ─────────────────────────────────────

t('SLA 三個分鐘欄位都已套用邊界驗證', () => {
  const code = src('modules/sla/sla.routes.ts');
  for (const field of ['firstResponseMinutes', 'resolutionMinutes', 'warningBeforeMinutes']) {
    assert.ok(
      code.includes(`${field}: slaMinutesSchema`),
      `${field} 未套用 slaMinutesSchema`,
    );
  }
  assert.ok(
    !/Minutes: z\.number\(\)\.int\(\)\.positive\(\)/.test(code),
    'sla.routes.ts 仍殘留無上限的 z.number().int().positive()',
  );
});

t('門戶積分調整已改用 zod（原本是裸轉型）', () => {
  const code = src('modules/portal/portal.routes.ts');
  assert.ok(code.includes('adjustPointsSchema'), 'portal 的積分調整未定義 schema');
  assert.ok(code.includes('amount: int4Schema'), 'amount 未套用 int4Schema');
  assert.ok(
    !code.includes("request.body as { contactId: string; amount: number"),
    'portal 仍殘留裸轉型的積分調整',
  );
});

t('system prompt 四個欄位都有長度上限', () => {
  const code = src('modules/settings/settings.routes.ts');
  for (const field of [
    'chatSystemPrompt',
    'summarizeSystemPrompt',
    'clarifySystemPrompt',
    'modelGuideSystemPrompt',
  ]) {
    assert.ok(
      code.includes(`${field}: systemPromptSchema`),
      `${field} 未套用 systemPromptSchema（無上限＝可撐爆 LLM token 預算）`,
    );
  }
  assert.ok(
    !/SystemPrompt: z\.string\(\)\.optional\(\)/.test(code),
    'settings 仍殘留無上限的 system prompt',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
