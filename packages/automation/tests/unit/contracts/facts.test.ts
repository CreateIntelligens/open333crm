/**
 * 自動化規則編輯器的「對話渠道」條件選項（change add-fb-ig-keyword-coupon design D7；
 * spec automation-engine「對話渠道條件列出 Instagram」）。
 *
 * 修正前選項只有 LINE、Facebook、WebChat：Instagram 的關鍵字回覆（條件「對話渠道等於 THREADS」）
 * 在編輯器裡顯示不出渠道。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AUTOMATION_FACT_DEFINITIONS, AUTOMATION_FACT_KEYS } from '#src/contracts/facts.js';
import { factToFieldOption } from '#src/contracts/ui.js';

test('條件選單有 Instagram：對話渠道的值選項有 Instagram，值為 THREADS', () => {
  const fact = AUTOMATION_FACT_DEFINITIONS.find((f) => f.key === AUTOMATION_FACT_KEYS.CONVERSATION_CHANNEL_TYPE)!;
  const option = factToFieldOption(fact);
  assert.equal(option.valueEditorType, 'select');
  assert.deepEqual(
    option.values?.map((v) => [v.name, v.label]),
    [['LINE', 'LINE'], ['FB', 'Facebook'], ['THREADS', 'Instagram'], ['WEBCHAT', 'WebChat']],
  );
});
