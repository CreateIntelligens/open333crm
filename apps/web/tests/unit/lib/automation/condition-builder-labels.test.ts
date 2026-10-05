/**
 * 條件建構器中文化（change improve-automation-page-readability）。
 * 原本顯示套件內建的英文：AND / OR、+ Rule、+ Group、滑鼠提示 Remove rule 等。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CONDITION_COMBINATORS, CONDITION_TRANSLATIONS } from '#src/lib/automation/condition-builder-labels.js';

test('Condition builder in Chinese：按鈕與組合方式是中文', () => {
  assert.deepEqual(
    CONDITION_COMBINATORS.map((c) => [c.name, c.label]),
    [['and', '全部符合'], ['or', '任一符合']],
    '值仍是 and / or，qb-to-engine 依此轉成 all / any',
  );
  assert.equal(CONDITION_TRANSLATIONS.addRule.label, '+ 新增條件');
  assert.equal(CONDITION_TRANSLATIONS.addGroup.label, '+ 新增條件群組');
});

test('所有顯示文字與滑鼠提示都沒有英文', () => {
  for (const [key, entry] of Object.entries(CONDITION_TRANSLATIONS)) {
    for (const [prop, text] of Object.entries(entry as Record<string, string>)) {
      if (prop === 'placeholderName') continue; // 內部值，不顯示
      assert.doesNotMatch(String(text), /[A-Za-z]/, `${key}.${prop}：${text}`);
    }
  }
});
