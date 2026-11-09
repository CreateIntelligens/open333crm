/**
 * 動作參數的值檢查（issue #469，AUDIT AUTO-12；spec automation-contract-composer
 * 「Contract Compatibility Validation」「Fact And Action Definitions」）。
 *
 * 修正前 validateActionParams() 只檢查必填：API、CLI、MCP 可以存 `status: "FOO"` 的規則，
 * 觸發時才在 workers 因 Prisma enum 錯誤失敗、只寫 log。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateAutomationRuleContract } from '#src/contracts/validation.js';
import { AUTOMATION_ACTION_MAP } from '#src/contracts/actions.js';

const MATCH_ALL = { all: [] };

function validate(eventName: string, actions: unknown[]) {
  return validateAutomationRuleContract({ eventName, conditions: MATCH_ALL, actions });
}

test('Select parameter outside the options rejected：更新工單狀態存 FOO 被擋，錯誤寫出動作與參數', () => {
  const result = validate('case.created', [{ type: 'update_case_status', params: { status: 'FOO' } }]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['第 1 個動作「更新工單狀態」的「目標狀態」不能是「FOO」，請從選項中選擇']);
});

test('Select parameter outside the options rejected：優先級與分類不在選項內也被擋', () => {
  const priority = validate('case.created', [{ type: 'set_case_priority', params: { priority: 'SUPER' } }]);
  assert.equal(priority.valid, false);
  assert.match(priority.errors[0]!, /「優先級」不能是「SUPER」/);

  const category = validate('message.received', [
    { type: 'create_case', params: { title: '客訴', category: '不存在的分類' } },
  ]);
  assert.equal(category.valid, false);
  assert.match(category.errors[0]!, /「分類」不能是「不存在的分類」/);
});

test('Select parameter outside the options rejected：值的型別不同也不算選項（數字 1 不等於字串）', () => {
  const result = validate('case.created', [{ type: 'update_case_status', params: { status: 1 } }]);
  assert.equal(result.valid, false);
});

test('Empty optional select parameter accepted：建立工單的優先級空白時通過', () => {
  const result = validate('message.received', [{ type: 'create_case', params: { title: '客訴', priority: '' } }]);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('選項內的值通過', () => {
  const result = validate('case.created', [
    { type: 'update_case_status', params: { status: 'IN_PROGRESS' } },
    { type: 'set_case_priority', params: { priority: 'URGENT' } },
  ]);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('Case status action offers pending：狀態選項有待處理，設 PENDING 的規則通過驗證', () => {
  const statusParam = AUTOMATION_ACTION_MAP.get('update_case_status')!.params!.find((p) => p.key === 'status')!;
  assert.ok(statusParam.values!.some((o) => o.value === 'PENDING' && o.label === '待處理'));

  const result = validate('case.created', [{ type: 'update_case_status', params: { status: 'PENDING' } }]);
  assert.deepEqual(result, { valid: true, errors: [] });
});
