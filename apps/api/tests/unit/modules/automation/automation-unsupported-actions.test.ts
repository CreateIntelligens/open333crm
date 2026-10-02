/**
 * workers 尚未支援的自動化動作：存檔時擋下、前端不提供、既有規則照常只跳過該動作（AUDIT AUTO-01）。
 * 原本這 5 種動作可以存檔、也會命中，workers 卻只記一行 info log 就略過，租戶以為規則有效。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  AUTOMATION_EVENT_NAMES,
  UNSUPPORTED_AUTOMATION_ACTION_TYPES,
  composeAutomationContract,
  findUnsupportedAutomationActions,
  getAutomationActionOptionsForEvent,
  validateAutomationRuleContract,
} from '@open333crm/automation';

const EVENT = AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED;
const UNSUPPORTED = ['remove_tag', 'assign_bot', 'kb_auto_reply', 'llm_reply'];

test('不支援的動作清單就是這 4 種（create_case 已補上實作）', () => {
  assert.deepEqual([...UNSUPPORTED_AUTOMATION_ACTION_TYPES].sort(), [...UNSUPPORTED].sort());
});

test('規則編輯器的動作選項不含不支援的動作', () => {
  const types = getAutomationActionOptionsForEvent(EVENT).map((o) => o.value);
  for (const t of UNSUPPORTED) assert.ok(!types.includes(t), t);
  assert.ok(types.includes('send_message'), '支援的動作照常提供');
  const contractTypes = composeAutomationContract(EVENT)!.actions.map((a) => a.type);
  for (const t of UNSUPPORTED) assert.ok(!contractTypes.includes(t), t);
});

test('存檔驗證：含不支援的動作就拒絕，訊息說明是哪個動作', () => {
  const result = validateAutomationRuleContract({
    eventName: EVENT,
    conditions: { all: [] },
    actions: [{ type: 'send_message', params: { text: 'hi' } }, { type: 'llm_reply', params: {} }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('LLM 智能回覆') && e.includes('尚未支援')), result.errors.join('; '));
});

test('執行時（workers）：既有規則照常通過驗證，只在執行時跳過不支援的動作', () => {
  const result = validateAutomationRuleContract({
    eventName: EVENT,
    conditions: { all: [] },
    actions: [{ type: 'send_message', params: { text: 'hi' } }, { type: 'llm_reply', params: {} }],
    options: { allowUnsupportedActions: true },
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('找出規則中不支援的動作（給規則列表與編輯頁提示用）', () => {
  assert.deepEqual(
    findUnsupportedAutomationActions([{ type: 'send_message' }, { type: 'remove_tag' }, { type: 'llm_reply' }, 'bad']),
    [
      { type: 'remove_tag', label: '移除標籤' },
      { type: 'llm_reply', label: 'LLM 智能回覆' },
    ],
  );
  assert.deepEqual(findUnsupportedAutomationActions(undefined), []);
});

test('既有規則含不支援的動作：只改啟用狀態或名稱照常成功（停用壞掉的規則不能被擋）；改動作才驗證', async () => {
  const { updateRule } = await import('#src/modules/automation/automation.service.js');
  const existing = {
    id: 'r1',
    tenantId: 't1',
    eventType: EVENT,
    trigger: { type: EVENT },
    conditions: { all: [] },
    actions: [{ type: 'llm_reply', params: {} }],
  };
  const updates: unknown[] = [];
  const prisma = {
    automationRule: {
      findFirst: async () => existing,
      update: async (args: unknown) => {
        updates.push(args);
        return existing;
      },
    },
  } as never;
  await updateRule(prisma, 'r1', 't1', { isActive: false });
  await updateRule(prisma, 'r1', 't1', { name: '改名' });
  assert.equal(updates.length, 2);
  await assert.rejects(
    () => updateRule(prisma, 'r1', 't1', { actions: [{ type: 'llm_reply', params: {} }] }),
    /尚未支援/,
  );
});

test('建立工單：收到訊息、關鍵字、對話建立可用；工單、SLA、聯絡人事件不提供（工單渠道取自對話，也避免迴圈）', () => {
  const offered = (event: string) => getAutomationActionOptionsForEvent(event).map((o) => o.value).includes('create_case');
  for (const e of [AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED, AUTOMATION_EVENT_NAMES.KEYWORD_MATCHED, AUTOMATION_EVENT_NAMES.CONVERSATION_CREATED]) {
    assert.equal(offered(e), true, e);
  }
  for (const e of [AUTOMATION_EVENT_NAMES.CASE_CREATED, AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_BREACHED, AUTOMATION_EVENT_NAMES.CONTACT_TAGGED]) {
    assert.equal(offered(e), false, e);
  }
  const ok = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.KEYWORD_MATCHED,
    conditions: { all: [] },
    actions: [{ type: 'create_case', params: { title: '客訴', priority: 'HIGH' } }],
  });
  assert.deepEqual(ok, { valid: true, errors: [] });
});

test('建立工單的分類選項與系統分類清單一致（避免兩份清單不同步）', async () => {
  const { CASE_CATEGORIES } = await import('@open333crm/shared');
  const { AUTOMATION_ACTION_MAP } = await import('@open333crm/automation');
  const category = AUTOMATION_ACTION_MAP.get('create_case')!.params!.find((p) => p.key === 'category')!;
  assert.equal(category.type, 'select');
  assert.deepEqual(category.values!.map((v) => v.value), [...CASE_CATEGORIES]);
});
