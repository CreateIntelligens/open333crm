/**
 * 編輯既有規則時，載入的動作要濾掉 workers 尚未支援的動作（AUDIT AUTO-01）。
 * 原本靠「動作選項改變時」才過濾，規則觸發事件與預設相同（收到訊息）時不會重跑，
 * 不支援的動作留在表單裡，儲存時被後端以 400 拒絕，與畫面提示「儲存時會移除」不符。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { toEditorActions } from '#src/lib/automation/rule-actions.js';

test('載入既有規則：轉成編輯器格式並濾掉不支援的動作', () => {
  assert.deepEqual(
    toEditorActions([
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'llm_reply', params: {} },
      { type: 'add_tag', payload: { tagName: 'VIP' } },
    ]),
    [
      { type: 'send_message', payload: { text: 'hi' } },
      { type: 'add_tag', payload: { tagName: 'VIP' } },
    ],
  );
});

test('沒有動作或格式不對：回空陣列', () => {
  assert.deepEqual(toEditorActions(undefined), []);
  assert.deepEqual(toEditorActions('bad'), []);
});

test('選填的下拉參數：最前面加「不指定」，畫面顯示與實際存的值一致', async () => {
  const { selectOptionsForParam } = await import('#src/lib/automation/rule-actions.js');
  const values = [{ value: 'LOW', label: '低' }, { value: 'HIGH', label: '高' }];
  assert.deepEqual(selectOptionsForParam({ key: 'priority', required: false, values }), [
    { value: '', label: '不指定' },
    { value: 'LOW', label: '低' },
    { value: 'HIGH', label: '高' },
  ]);
  assert.equal(selectOptionsForParam({ key: 'category', values })[0]!.label, '不指定（由 AI 分類）');
  assert.deepEqual(
    selectOptionsForParam({ key: 'status', required: true, values }).map((o) => o.value),
    ['LOW', 'HIGH'],
    '必填的不加',
  );
});
