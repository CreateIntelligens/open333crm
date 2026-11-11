/**
 * 關鍵字的比對結果一致（change outbox-event-delivery：automation-engine「關鍵字的比對結果一致」
 * 「關鍵字規則在處理收到的訊息時比對」）。
 *
 * AI 是否讓步（api 的 hasMatchingKeywordRule）與 workers 執行關鍵字規則，都用 matchKeywordTrigger() 判斷命中。
 * hasMatchingKeywordRule 本身的測試在 apps/api/tests/unit/modules/automation/keyword-yield-channel.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { matchKeywordTrigger } from '#src/keyword/keyword-match.js';

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

test('舊資料含空白關鍵字：不命中任何訊息，AI 照常回覆', () => {
  assert.equal(matchKeywordTrigger(rule(['']).trigger, '你好'), null);
  assert.equal(matchKeywordTrigger(rule(['  ', 3, null]).trigger, '你好'), null);
});

test('訊息沒有命中：沒有規則的關鍵字出現在這則訊息', () => {
  assert.equal(matchKeywordTrigger(rule(['營業時間']).trigger, '你好'), null);
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
