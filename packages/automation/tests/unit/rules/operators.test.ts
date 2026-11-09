/**
 * 文字欄位比對數字比較值（change fix-automation-numeric-text-conditions，issue #418、AUDIT AUTO-06）。
 *
 * 舊版規則編輯器把「8888」存成數字 8888；運算子對文字欄位比對數字時永遠不成立，
 * 「訊息內容 包含 8888」這類規則永遠不觸發。這裡用 evaluateRules（workers 與試跑共用）測行為。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { TopLevelCondition } from 'json-rules-engine';
import { evaluateRules } from '#src/rules/evaluator.js';

async function matches(condition: Record<string, unknown>, facts: Record<string, unknown>): Promise<boolean> {
  const matched = await evaluateRules(
    [{ id: 'r1', name: 'r1', priority: 1, stopOnMatch: false, conditions: { all: [condition] } as TopLevelCondition, actions: [] }],
    facts,
  );
  return matched.length > 0;
}

test('訊息內容包含數字比較值：contains("我的單號 8888", 8888) 成立', async () => {
  assert.equal(await matches({ fact: 'message.text', operator: 'contains', value: 8888 }, { 'message.text': '我的單號 8888' }), true);
  assert.equal(await matches({ fact: 'message.text', operator: 'contains', value: 8888 }, { 'message.text': '我的單號 7777' }), false);
});

test('文字欄位等於數字比較值：名稱「1」等於 1，「12」不等於 1', async () => {
  assert.equal(await matches({ fact: 'contact.name', operator: 'equal', value: 1 }, { 'contact.name': '1' }), true);
  assert.equal(await matches({ fact: 'contact.name', operator: 'equal', value: 1 }, { 'contact.name': '12' }), false);
  assert.equal(await matches({ fact: 'contact.name', operator: 'notEqual', value: 1 }, { 'contact.name': '1' }), false);
  assert.equal(await matches({ fact: 'contact.name', operator: 'notEqual', value: 1 }, { 'contact.name': '12' }), true);
});

test('文字欄位 in / notIn 數字清單', async () => {
  assert.equal(await matches({ fact: 'contact.name', operator: 'in', value: [1, 2] }, { 'contact.name': '2' }), true);
  assert.equal(await matches({ fact: 'contact.name', operator: 'notIn', value: [1, 2] }, { 'contact.name': '2' }), false);
});

test('標籤包含數字比較值：標籤「8888」「VIP」包含 8888', async () => {
  const facts = { 'contact.tags': ['8888', 'VIP'] };
  assert.equal(await matches({ fact: 'contact.tags', operator: 'contains', value: 8888 }, facts), true);
  assert.equal(await matches({ fact: 'contact.tags', operator: 'containsAny', value: [8888, 1] }, facts), true);
  assert.equal(await matches({ fact: 'contact.tags', operator: 'containsAll', value: [8888, 'VIP'] }, facts), true);
});

test('不包含數字比較值：訊息「單號 8888」不包含 8888 不成立', async () => {
  assert.equal(await matches({ fact: 'message.text', operator: 'notContains', value: 8888 }, { 'message.text': '單號 8888' }), false);
  assert.equal(await matches({ fact: 'message.text', operator: 'notContains', value: 8888 }, { 'message.text': '單號 7777' }), true);
});

test('startsWith、textContains、matchesRegex 也接受數字比較值', async () => {
  assert.equal(await matches({ fact: 'message.text', operator: 'startsWith', value: 1 }, { 'message.text': '1 查訂單' }), true);
  assert.equal(await matches({ fact: 'message.text', operator: 'textContains', value: 2 }, { 'message.text': '選 2' }), true);
  assert.equal(await matches({ fact: 'message.text', operator: 'matchesRegex', value: 8888 }, { 'message.text': '單號 8888' }), true);
});

test('數字欄位比對不變：開啟案件數 0 等於 0，1 不等於 0，字串比較值不轉', async () => {
  assert.equal(await matches({ fact: 'case.open.count', operator: 'equal', value: 0 }, { 'case.open.count': 0 }), true);
  assert.equal(await matches({ fact: 'case.open.count', operator: 'equal', value: 0 }, { 'case.open.count': 1 }), false);
  // 只轉「欄位值是文字、比較值是數字」這一個方向；欄位值是數字時維持嚴格比對
  assert.equal(await matches({ fact: 'case.open.count', operator: 'equal', value: '0' }, { 'case.open.count': 0 }), false);
  assert.equal(await matches({ fact: 'case.open.count', operator: 'greaterThan', value: 2 }, { 'case.open.count': 3 }), true);
});

test('布林欄位比對不變', async () => {
  assert.equal(await matches({ fact: 'contact.isVip', operator: 'equal', value: true }, { 'contact.isVip': true }), true);
  assert.equal(await matches({ fact: 'contact.isVip', operator: 'equal', value: true }, { 'contact.isVip': false }), false);
});
