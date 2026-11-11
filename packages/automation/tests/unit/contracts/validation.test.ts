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

// ── 參數型別（change validate-bot-config-and-action-params，issue #405）──────
// 修正前只檢查必填與下拉選項：send_message 的 text 是物件時，workers 以 String() 送出「[object Object]」。

test('Text parameter that is not a string rejected：訊息內容是物件被擋，錯誤寫出動作與參數', () => {
  const result = validate('message.received', [{ type: 'send_message', params: { text: { a: 1 } } }]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['第 1 個動作「傳送訊息」的「訊息內容」必須是文字']);
});

test('Text parameter that is not a string rejected：標籤名稱、客服、素材、優惠券是數字或陣列也被擋', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['add_tag', { tagName: 123 }, /「新增標籤」的「標籤名稱」必須是文字/],
    ['notify', { message: '有新訊息', agentId: 7 }, /「傳送通知」的「通知誰」必須是文字/],
    ['send_material', { materialId: ['x'] }, /「傳送素材」的「素材」必須是文字/],
    ['issue_coupon', { couponId: 'c1', failureText: true }, /「發送優惠券」的「發不出時回覆顧客」必須是文字/],
    ['create_case', { title: { zh: '標題' } }, /「建立工單」的「工單標題」必須是文字/],
  ];
  for (const [type, params, message] of cases) {
    const result = validate('message.received', [{ type, params }]);
    assert.equal(result.valid, false, type);
    assert.match(result.errors[0]!, message);
  }
});

test('Parameters sent by the rule editor accepted：規則編輯器、關鍵字回覆、加好友禮送出的參數都是字串，通過', () => {
  const result = validate('message.received', [
    { type: 'send_message', params: { text: '您好，請稍候' } },
    { type: 'create_case', params: { title: '客訴', priority: 'HIGH', category: '退換貨' } },
    { type: 'add_tag', params: { tagName: 'VIP' } },
    { type: 'remove_tag', params: { tagName: '潛在客戶' } },
    { type: 'send_material', params: { materialId: '0b1c2d3e-4f50-4a6b-8c7d-8e9f0a1b2c3d' } },
    { type: 'issue_coupon', params: { couponId: '1b1c2d3e-4f50-4a6b-8c7d-8e9f0a1b2c3d', failureText: '您已經領過這張券囉' } },
    { type: 'notify', params: { message: '有新訊息', agentId: '2b1c2d3e-4f50-4a6b-8c7d-8e9f0a1b2c3d' } },
    { type: 'notify_supervisor', params: { message: '請主管處理' } },
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('Parameters not in the contract are not checked：send_material 的 variables 照舊接受', () => {
  const result = validate('message.received', [
    { type: 'send_material', params: { materialId: '0b1c2d3e-4f50-4a6b-8c7d-8e9f0a1b2c3d', variables: { name: '王' } } },
  ]);
  assert.equal(result.valid, true);
});
