/**
 * 編輯既有規則時，載入的動作要濾掉這個觸發事件的契約沒有提供的動作。
 * 原本靠「動作選項改變時」才過濾，規則觸發事件與預設相同（收到訊息）時不會重跑，
 * 這類動作留在表單裡，儲存時被後端以 400 拒絕，與畫面提示「儲存時會移除」不符。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  findWorkerSkipErrors,
  ruleEventName,
  splitRuleActions,
} from '#src/lib/automation/rule-actions.js';

test('載入既有規則：轉成編輯器格式並濾掉不支援的動作', () => {
  const { actions } = splitRuleActions(
    [
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'llm_reply', params: {} },
      { type: 'add_tag', payload: { tagName: 'VIP' } },
    ],
    'message.received',
  );
  assert.deepEqual(actions, [
    { type: 'send_message', payload: { text: 'hi' } },
    { type: 'add_tag', payload: { tagName: 'VIP' } },
  ]);
});

test('沒有動作或格式不對：回空陣列', () => {
  assert.deepEqual(splitRuleActions(undefined, 'message.received'), { actions: [], dropped: [] });
  assert.deepEqual(splitRuleActions('bad', 'message.received'), { actions: [], dropped: [] });
});

/*
 * 契約從來沒有的動作（例如 UAT 舊規則的 auto_assign）原本留在表單上，儲存時被後端以 400 拒絕，
 * 畫面也沒說是哪個動作。這類動作會讓 workers 略過整條規則，編輯頁要說明。
 */
test('Rule contains an action outside the contract：保留傳送訊息、移除 auto_assign，整條規則不會執行', () => {
  const result = splitRuleActions(
    [
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'auto_assign', params: {} },
    ],
    'message.received',
  );
  assert.deepEqual(result.actions, [{ type: 'send_message', payload: { text: 'hi' } }]);
  assert.deepEqual(result.dropped, [{ type: 'auto_assign', label: '未知動作（auto_assign）' }]);
});

test('Rule contains an action that the event does not offer：工單關閉不能傳送訊息', () => {
  const result = splitRuleActions([{ type: 'send_message', params: { text: 'bye' } }], 'case.closed');
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.dropped, [{ type: 'send_message', label: '傳送訊息' }]);
});

/* llm_reply 已從契約拿掉（change fix-automation-remaining-actions）：整條規則不會執行，畫面用中文名稱標示已停用 */
test('Rule contains an unsupported action：llm_reply 列為「LLM 智能回覆（已停用）」', () => {
  const result = splitRuleActions([{ type: 'llm_reply', params: {} }], 'message.received');
  assert.deepEqual(result.dropped, [{ type: 'llm_reply', label: 'LLM 智能回覆（已停用）' }]);
});

test('格式錯誤的動作：也列為被移除，不會默默消失', () => {
  const result = splitRuleActions([null, { params: {} }], 'message.received');
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.dropped, [
    { type: '', label: '格式錯誤的動作' },
    { type: '', label: '格式錯誤的動作' },
  ]);
});

test('Rule has no trigger type：改用 eventType', () => {
  assert.equal(ruleEventName({ trigger: {}, eventType: 'case.created' }), 'case.created');
  assert.equal(ruleEventName({ trigger: { type: 'keyword.matched' }, eventType: 'case.created' }), 'keyword.matched');
  assert.equal(ruleEventName({}), 'message.received');
});

/* workers 驗證失敗時整條規則略過、只寫 log；列表要標出來，管理員才看得到 */
test('Rule List Marks Rules The Workers Skip：含契約外動作的規則', () => {
  const errors = findWorkerSkipErrors({
    trigger: { type: 'message.received' },
    conditions: { all: [] },
    actions: [{ type: 'auto_assign', params: {} }],
  });
  assert.deepEqual(errors, ['第 1 個動作「auto_assign」不是系統提供的動作，請刪除']);
});

test('Rule contains only unsupported actions besides valid ones：含 llm_reply 的規則標示不會執行', () => {
  const errors = findWorkerSkipErrors({
    trigger: { type: 'message.received' },
    conditions: { all: [] },
    actions: [
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'llm_reply', params: {} },
    ],
  });
  assert.deepEqual(errors, ['第 2 個動作「LLM 智能回覆」已停用，請刪除']);
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

/* 「指派客服」原本要手動填 Agent UUID，一般管理員不可能知道 */
test('指派客服的選項：顯示姓名與 email；已存的客服不在名單時明確標出', async () => {
  const { agentOptions } = await import('#src/lib/automation/rule-actions.js');
  const agents = [
    { id: 'a1', name: '王小明', email: 'ming@example.com' },
    { id: 'a2', name: '', email: 'li@example.com' },
  ];
  assert.deepEqual(agentOptions(agents, ''), [
    { value: '', label: '請選擇客服' },
    { value: 'a1', label: '王小明（ming@example.com）' },
    { value: 'a2', label: 'li@example.com' },
  ]);
  assert.deepEqual(agentOptions(agents, 'gone-1234567890').at(-1), {
    value: 'gone-1234567890',
    label: '已停用或找不到的客服（gone-123）',
  });
});

test('客服名單還沒載入時，不把已指派的客服標成已停用', async () => {
  const { agentOptions } = await import('#src/lib/automation/rule-actions.js');
  assert.deepEqual(agentOptions([], 'a1', false), [
    { value: '', label: '請選擇客服' },
    { value: 'a1', label: '載入客服名單中…' },
  ]);
});

/*
 * 編輯頁紅框的說明：原本一律寫「不適用於這個觸發事件」「儲存後規則就會恢復執行」。
 * 已停用的動作不是「不適用」；移除後沒有任何動作時，存檔會被擋，也不會恢復執行。
 */
test('紅框說明：已停用的動作說明已停用；移除後沒有動作時請管理員新增或刪除', async () => {
  const { droppedActionsMessage } = await import('#src/lib/automation/rule-actions.js');
  const retired = { type: 'llm_reply', label: 'LLM 智能回覆（已停用）', skipsRule: true };
  const invalid = { type: 'send_message', label: '傳送訊息', skipsRule: true };
  assert.equal(
    droppedActionsMessage([retired], 0),
    '此規則含有系統已停用的動作：「LLM 智能回覆（已停用）」，目前整條規則都不會執行。編輯器已移除這些動作，規則目前沒有任何動作：請新增動作後再儲存，或刪除這條規則。',
  );
  assert.equal(
    droppedActionsMessage([invalid, retired], 1),
    '此規則含有不適用於這個觸發事件的動作：「傳送訊息」；系統已停用的動作：「LLM 智能回覆（已停用）」，目前整條規則都不會執行。編輯器已移除這些動作，儲存後其他動作就會照常執行。',
  );
  assert.equal(droppedActionsMessage([], 1), '');
  // 兩種都有、而且移除後沒有剩下任何動作（PR #229 審查）
  assert.equal(
    droppedActionsMessage([invalid, retired], 0),
    '此規則含有不適用於這個觸發事件的動作：「傳送訊息」；系統已停用的動作：「LLM 智能回覆（已停用）」，目前整條規則都不會執行。編輯器已移除這些動作，規則目前沒有任何動作：請新增動作後再儲存，或刪除這條規則。',
  );
});
