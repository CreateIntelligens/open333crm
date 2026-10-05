/**
 * 規則摘要句（change improve-automation-page-readability）。
 * 列表原本只顯示程式代碼（message.received），管理員看不出規則在做什麼。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { summarizeConditions, summarizeRule } from '#src/lib/automation/rule-summary.js';

test('Rule with one condition and one action', () => {
  assert.equal(
    summarizeRule({
      trigger: { type: 'message.received' },
      conditions: { all: [{ fact: 'case.open.count', operator: 'equal', value: 0 }] },
      actions: [{ type: 'create_case', params: { title: '客戶諮詢', priority: 'MEDIUM' } }],
    }),
    '當收到訊息時，如果開啟案件數等於 0，就建立工單「客戶諮詢」',
  );
});

test('Rule with any-group conditions', () => {
  assert.equal(
    summarizeConditions({
      any: [
        { fact: 'message.text', operator: 'contains', value: '退款' },
        { fact: 'message.text', operator: 'contains', value: '客訴' },
      ],
    }),
    '訊息內容包含「退款」，或訊息內容包含「客訴」',
  );
});

test('Select value shown by label', () => {
  assert.equal(
    summarizeConditions({ all: [{ fact: 'case.priority', operator: 'equal', value: 'HIGH' }] }),
    '案件優先級等於高',
  );
});

test('巢狀群組加括號；沒有條件時省略「如果」', () => {
  assert.equal(
    summarizeConditions({
      all: [
        { fact: 'case.open.count', operator: 'equal', value: 0 },
        { any: [
          { fact: 'message.text', operator: 'contains', value: '退款' },
          { fact: 'message.text', operator: 'exists' },
        ] },
      ],
    }),
    '開啟案件數等於 0，而且（訊息內容包含「退款」，或訊息內容有值）',
  );
  assert.equal(
    summarizeRule({ trigger: { type: 'case.created' }, conditions: { all: [] }, actions: [{ type: 'add_tag', params: { tagName: 'VIP' } }] }),
    '當工單建立時，就新增標籤「VIP」',
  );
});

test('多個動作用「、」連接；沒有動作時寫「不做任何事」；契約沒有的沿用代碼', () => {
  assert.equal(
    summarizeRule({
      eventType: 'message.received',
      conditions: {},
      actions: [{ type: 'notify_supervisor', params: { message: '有客訴' } }, { type: 'auto_assign', params: {} }],
    }),
    '當收到訊息時，就通知主管「有客訴」、未知動作（auto_assign）',
  );
  assert.equal(summarizeRule({ trigger: { type: 'message.received' }, conditions: {}, actions: [] }), '當收到訊息時，不做任何事');
});

test('長文字截斷，避免摘要過長', () => {
  const s = summarizeRule({
    trigger: { type: 'message.received' },
    conditions: {},
    actions: [{ type: 'send_message', params: { text: '您好，感謝您的來信，我們會盡快由專人回覆您的問題，請稍候' } }],
  });
  assert.equal(s, '當收到訊息時，就傳送訊息「您好，感謝您的來信，我們會盡快由專人…」');
});

/* code review：素材、客服的參數是 ID，摘要不顯示 ID */
test('參數是 ID 時只顯示動作名稱', () => {
  assert.equal(
    summarizeRule({
      trigger: { type: 'keyword.matched' },
      conditions: {},
      actions: [
        { type: 'send_material', params: { materialId: '3f2a9c1e-8b7d-4e1a-9c2b-1234567890ab' } },
        { type: 'assign_agent', params: { agentId: 'b0000000-0000-0000-0000-000000000001' } },
      ],
    }),
    '當關鍵字命中時，就傳送素材、指派客服',
  );
});

/* code review：關鍵字規則條件是空的，摘要要寫出是哪些關鍵字，否則幾十條都一樣 */
test('關鍵字規則寫出關鍵字與比對方式', () => {
  const rule = (match_mode: string) => ({
    trigger: { type: 'keyword.matched', keywords: ['退款', '退貨'], match_mode },
    conditions: { all: [] },
    actions: [{ type: 'add_tag', params: { tagName: '退款需求' } }],
  });
  assert.equal(summarizeRule(rule('any')), '當訊息含有「退款」或「退貨」時，就新增標籤「退款需求」');
  assert.equal(summarizeRule(rule('all')), '當訊息同時含有「退款」和「退貨」時，就新增標籤「退款需求」');
});

/* code review：認不得的條件節點原本被默默丟掉，摘要看起來像沒有條件 */
test('認不得的條件不丟掉，標示無法顯示', () => {
  assert.equal(
    summarizeConditions({ all: [{ not: { fact: 'message.text', operator: 'contains', value: 'x' } }] }),
    '（無法顯示的條件）',
  );
});

/* 已停用的動作用中文名稱標示，不顯示代碼（change fix-automation-remaining-actions） */
test('已停用的動作：摘要顯示「LLM 智能回覆（已停用）」', () => {
  assert.equal(
    summarizeRule({ trigger: { type: 'message.received' }, conditions: {}, actions: [{ type: 'llm_reply', params: {} }] }),
    '當收到訊息時，就LLM 智能回覆（已停用）',
  );
});
