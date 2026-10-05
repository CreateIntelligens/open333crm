/**
 * 規則列表（change improve-automation-page-readability）。
 * 觸發事件原本顯示程式代碼，140 條規則也沒有搜尋與篩選。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { filterRules, ruleEventLabel } from '#src/lib/automation/rule-list.js';

const rules = [
  { id: '1', name: '一般問題自動開案', isActive: true },
  { id: '2', name: '客訴自動開案', isActive: false },
  { id: '3', name: 'VIP 貼標', isActive: true },
];

test('Event shown by label', () => {
  assert.equal(ruleEventLabel({ trigger: { type: 'conversation.created' } }), '新對話建立');
  assert.equal(ruleEventLabel({ eventType: 'message.received' }), '收到訊息');
  assert.equal(ruleEventLabel({ trigger: { type: 'portal.activity.submitted' } }), 'portal.activity.submitted', '契約沒有的沿用代碼');
});

test('Search by name：不分大小寫、前後空白不影響', () => {
  assert.deepEqual(filterRules(rules, { query: '開案', status: 'all' }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(filterRules(rules, { query: '  vip ', status: 'all' }).map((r) => r.id), ['3']);
  assert.deepEqual(filterRules(rules, { query: '', status: 'all' }).map((r) => r.id), ['1', '2', '3']);
});

test('Filter by active state', () => {
  assert.deepEqual(filterRules(rules, { query: '', status: 'inactive' }).map((r) => r.id), ['2']);
  assert.deepEqual(filterRules(rules, { query: '開案', status: 'active' }).map((r) => r.id), ['1']);
});
