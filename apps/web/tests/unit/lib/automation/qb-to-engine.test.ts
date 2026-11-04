/**
 * 條件值依欄位型別儲存（issue #418、AUDIT AUTO-06；change fix-automation-numeric-text-conditions）。
 * 原本 parseValue 把所有數字字串轉成數字，「訊息內容 包含 8888」存成 value: 8888，規則永遠不觸發。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { RuleGroupType } from 'react-querybuilder';
import { engineToQb, qbToEngine } from '#src/lib/automation/qb-to-engine.js';

function leaf(field: string, operator: string, value: string): RuleGroupType {
  return { combinator: 'and', rules: [{ field, operator, value }] };
}

test('文字欄位的純數字保留字串：訊息內容 包含 8888 送出 value "8888"', () => {
  assert.deepEqual(qbToEngine(leaf('message.text', 'contains', '8888')), {
    all: [{ fact: 'message.text', operator: 'contains', value: '8888' }],
  });
  // 其他文字欄位：聯絡人名稱、標籤（文字清單）、語言
  assert.equal((qbToEngine(leaf('contact.name', '=', '1')).all as Array<{ value: unknown }>)[0].value, '1');
  assert.equal((qbToEngine(leaf('contact.tags', 'contains', '0912345678')).all as Array<{ value: unknown }>)[0].value, '0912345678');
  // 文字欄位填「true」也是文字，不轉布林
  assert.equal((qbToEngine(leaf('message.text', 'contains', 'true')).all as Array<{ value: unknown }>)[0].value, 'true');
});

test('數字欄位轉成數字：開啟案件數 等於 3 送出 value 3', () => {
  assert.deepEqual(qbToEngine(leaf('case.open.count', '=', '3')), {
    all: [{ fact: 'case.open.count', operator: 'equal', value: 3 }],
  });
});

test('是／否欄位轉成布林：聯絡人是 VIP 等於 是 送出 value true', () => {
  assert.equal((qbToEngine(leaf('contact.isVip', 'equal', 'true')).all as Array<{ value: unknown }>)[0].value, true);
  assert.equal((qbToEngine(leaf('is_vip_customer', 'equal', 'false')).all as Array<{ value: unknown }>)[0].value, false);
});

test('重存舊規則修正型別：已存成數字 8888 的訊息內容條件，載入再儲存後是字串 "8888"', () => {
  const stored = { all: [{ fact: 'message.text', operator: 'contains', value: 8888 }] };
  const loaded = engineToQb(stored);
  assert.equal((loaded.rules[0] as { value: unknown }).value, '8888');
  assert.deepEqual(qbToEngine(loaded), { all: [{ fact: 'message.text', operator: 'contains', value: '8888' }] });
});

test('巢狀群組也依欄位型別轉值', () => {
  const query: RuleGroupType = {
    combinator: 'or',
    rules: [
      { field: 'message.text', operator: 'contains', value: '1' },
      { combinator: 'and', rules: [{ field: 'case.open.count', operator: '>', value: '2' }] },
    ],
  };
  assert.deepEqual(qbToEngine(query), {
    any: [
      { fact: 'message.text', operator: 'contains', value: '1' },
      { all: [{ fact: 'case.open.count', operator: 'greaterThan', value: 2 }] },
    ],
  });
});
