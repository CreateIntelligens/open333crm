/**
 * 規則試跑表單（change improve-automation-page-readability）。
 * 原本要手寫 JSON 格式的 Facts，一般管理員無法使用。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildTestFacts, describeTestResult, testFormFields } from '#src/lib/automation/rule-test-form.js';

const conditions = {
  all: [
    { fact: 'message.text', operator: 'contains', value: '冷氣' },
    { any: [
      { fact: 'case.open.count', operator: 'equal', value: 0 },
      { fact: 'message.text', operator: 'contains', value: '壞' },
    ] },
  ],
};

test('Inputs follow the conditions：每個欄位一格，依型別決定輸入方式，不重複', () => {
  assert.deepEqual(
    testFormFields(conditions).map((f) => [f.key, f.label, f.input]),
    [
      ['message.text', '訊息內容', 'text'],
      ['case.open.count', '開啟案件數', 'number'],
    ],
  );
});

test('選項欄位提供下拉選單', () => {
  const [field] = testFormFields({ all: [{ fact: 'case.priority', operator: 'equal', value: 'HIGH' }] });
  assert.equal(field!.input, 'select');
  assert.deepEqual(field!.options?.find((o) => o.value === 'HIGH'), { value: 'HIGH', label: '高' });
});

test('沒有條件時沒有欄位', () => {
  assert.deepEqual(testFormFields({ all: [] }), []);
  assert.deepEqual(testFormFields(undefined), []);
});

test('填的值轉成對應型別；沒填的欄位不送', () => {
  const fields = testFormFields(conditions);
  assert.deepEqual(buildTestFacts(fields, { 'message.text': '我的冷氣壞了', 'case.open.count': '0' }), {
    'message.text': '我的冷氣壞了',
    'case.open.count': 0,
  });
  assert.deepEqual(buildTestFacts(fields, { 'message.text': '', 'case.open.count': '' }), {});
});

const actions = [{ type: 'create_case', params: { title: '客戶諮詢' } }];

test('Rule triggers：說明會觸發並列出動作', () => {
  assert.deepEqual(describeTestResult({ matched: true }, actions), {
    triggered: true,
    headline: '會觸發',
    actions: ['建立工單「客戶諮詢」'],
  });
});

test('Rule does not trigger：說明條件不符合', () => {
  assert.deepEqual(describeTestResult({ matched: false }, actions), {
    triggered: false,
    headline: '不會觸發：條件不符合',
    actions: [],
  });
});

/* code review：送出的值要符合欄位型別，否則規則條件永遠不符合 */
test('是／否欄位送布林值，不是字串 "true"', () => {
  const fields = testFormFields({ all: [{ fact: 'contact.isVip', operator: 'equal', value: true }] });
  assert.deepEqual(buildTestFacts(fields, { 'contact.isVip': 'true' }), { 'contact.isVip': true });
  assert.deepEqual(buildTestFacts(fields, { 'contact.isVip': 'false' }), { 'contact.isVip': false });
});

test('多值欄位（渠道）送陣列，「包含任一」才判斷得到', () => {
  const fields = testFormFields({ all: [{ fact: 'contact.channel', operator: 'containsAny', value: ['LINE'] }] });
  assert.equal(fields[0]!.input, 'select');
  assert.deepEqual(buildTestFacts(fields, { 'contact.channel': 'LINE' }), { 'contact.channel': ['LINE'] });
});

test('日期時間送帶時區的 ISO 字串', () => {
  const fields = testFormFields({ all: [{ fact: 'sla.dueAt', operator: 'lessThan', value: '2026-10-05T00:00:00.000Z' }] });
  assert.equal(fields[0]!.input, 'datetime');
  const facts = buildTestFacts(fields, { 'sla.dueAt': '2026-10-05T10:00' });
  assert.equal(facts['sla.dueAt'], new Date('2026-10-05T10:00').toISOString());
});

/* code review：試跑只評估條件；規則停用、事件不會送出、關鍵字沒命中時，實際都不會執行 */
test('條件符合但規則停用：說明實際不會執行', () => {
  assert.deepEqual(describeTestResult({ matched: true }, actions, { isActive: false, eventName: 'message.received' }), {
    triggered: false,
    headline: '條件符合，但規則目前停用，不會執行',
    actions: [],
  });
});

test('條件符合但事件目前不會觸發：說明實際不會執行', () => {
  assert.equal(
    describeTestResult({ matched: true }, actions, { isActive: true, eventName: 'case.closed' }).headline,
    '條件符合，但系統目前不會送出「工單關閉」事件，不會執行',
  );
});

test('關鍵字規則：提醒還要訊息含關鍵字', () => {
  assert.deepEqual(describeTestResult({ matched: true }, actions, { isActive: true, eventName: 'keyword.matched' }), {
    triggered: true,
    headline: '會觸發（客人的訊息還要含有設定的關鍵字）',
    actions: ['建立工單「客戶諮詢」'],
  });
});

/* code review：沒有條件時固定寫「每次都會執行」，沒看規則是否停用、事件會不會送出 */
test('沒有條件時的說明依已儲存的規則判斷', async () => {
  const { noConditionNote } = await import('#src/lib/automation/rule-test-form.js');
  assert.equal(noConditionNote({ isActive: true, trigger: { type: 'message.received' } }), '這條規則沒有條件，每次收到訊息都會執行。');
  assert.equal(noConditionNote({ isActive: false, trigger: { type: 'message.received' } }), '這條規則沒有條件，但目前停用，不會執行。');
  assert.equal(noConditionNote({ isActive: true, trigger: { type: 'case.closed' } }), '這條規則沒有條件，但系統目前不會送出「工單關閉」事件，不會執行。');
  assert.equal(noConditionNote({ isActive: true, trigger: { type: 'keyword.matched' } }), '這條規則沒有其他條件，客人的訊息含有設定的關鍵字就會執行。');
});
