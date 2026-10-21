/**
 * 關鍵字的比對結果一致（change outbox-event-delivery：automation-engine「關鍵字的比對結果一致」
 * 「關鍵字規則在處理收到的訊息時比對」）。
 *
 * AI 是否讓步（hasMatchingKeywordRule）與 workers 執行關鍵字規則，都用 matchKeywordTrigger() 判斷命中。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { matchKeywordTrigger } from '#src/keyword/keyword-match.js';
import { hasMatchingKeywordRule } from '#src/keyword/keyword-yield.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';

function rule(keywords: unknown, matchMode?: string) {
  return {
    id: 'rule-1',
    name: 'R',
    priority: 0,
    stopOnMatch: false,
    isActive: true,
    trigger: { type: 'keyword.matched', keywords, ...(matchMode ? { match_mode: matchMode } : {}) },
    conditions: { all: [] },
    actions: [{ type: 'send_message', params: { text: '營業時間是 9 點到 18 點' } }],
  };
}

function db(rules: unknown[]) {
  return {
    automationRule: { findMany: async () => rules },
    material: { findMany: async () => [] },
    contact: { findFirst: async () => null },
    conversation: { findFirst: async () => null },
    case: { findFirst: async () => null, count: async () => 0 },
  };
}

test('舊資料含空白關鍵字：不命中任何訊息，AI 照常回覆', async () => {
  assert.equal(matchKeywordTrigger(rule(['']).trigger, '你好'), null);
  assert.equal(matchKeywordTrigger(rule(['  ', 3, null]).trigger, '你好'), null);
  assert.equal(await hasMatchingKeywordRule(db([rule([''])]), TENANT, '你好', 'LINE'), false);
});

test('訊息沒有命中：沒有規則的關鍵字出現在這則訊息', async () => {
  assert.equal(matchKeywordTrigger(rule(['營業時間']).trigger, '你好'), null);
  assert.equal(await hasMatchingKeywordRule(db([rule(['營業時間'])]), TENANT, '你好', 'LINE'), false);
});

test('訊息命中：any 模式回傳出現的關鍵字，不分大小寫', () => {
  assert.deepEqual(matchKeywordTrigger(rule(['營業時間', 'Hours', '地址']).trigger, '請問營業 hours 與營業時間'), {
    matchedKeywords: ['營業時間', 'Hours'],
    matchMode: 'any',
  });
});

test('all 模式：每個關鍵字都要出現', () => {
  assert.equal(matchKeywordTrigger(rule(['退貨', '運費'], 'all').trigger, '我要退貨'), null);
  assert.deepEqual(matchKeywordTrigger(rule(['退貨', '運費'], 'all').trigger, '退貨的運費誰付'), {
    matchedKeywords: ['退貨', '運費'],
    matchMode: 'all',
  });
});

test('trigger 不是 keyword.matched：不命中', () => {
  assert.equal(matchKeywordTrigger({ type: 'message.received', keywords: ['你好'] }, '你好'), null);
});
