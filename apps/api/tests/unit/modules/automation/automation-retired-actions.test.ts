/**
 * 從契約拿掉的自動化動作（change fix-automation-remaining-actions，AUDIT AUTO-01，issue #197）。
 * remove_tag 已在 workers 補上；assign_bot、kb_auto_reply、llm_reply 從契約拿掉，
 * 「尚未支援的動作」機制一併移除：契約沒有定義的動作，存檔時一律以「不是系統提供的動作」拒絕。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as automation from '@open333crm/automation';
import {
  AUTOMATION_ACTION_MAP,
  AUTOMATION_EVENT_NAMES,
  composeAutomationContract,
  getAutomationActionOptionsForEvent,
  validateAutomationRuleContract,
} from '@open333crm/automation';

const EVENT = AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED;
const RETIRED = ['assign_bot', 'kb_auto_reply', 'llm_reply'];

test('契約不再定義 assign_bot、kb_auto_reply、llm_reply；remove_tag 照常提供', () => {
  for (const t of RETIRED) assert.equal(AUTOMATION_ACTION_MAP.has(t), false, t);
  const offered = getAutomationActionOptionsForEvent(EVENT).map((o) => o.value);
  assert.ok(offered.includes('remove_tag'), 'remove_tag 已有實作，編輯器要提供');
  assert.ok(composeAutomationContract(EVENT)!.actions.some((a) => a.type === 'remove_tag'));
});

test('「尚未支援的動作」機制已移除', () => {
  const exported = automation as Record<string, unknown>;
  assert.equal(exported.UNSUPPORTED_AUTOMATION_ACTION_TYPES, undefined);
  assert.equal(exported.findUnsupportedAutomationActions, undefined);
});

test('Unsupported action is rejected：含 llm_reply 的規則以「不是系統提供的動作」拒絕', () => {
  const result = validateAutomationRuleContract({
    eventName: EVENT,
    conditions: { all: [] },
    actions: [{ type: 'send_message', params: { text: 'hi' } }, { type: 'llm_reply', params: {} }],
  });
  assert.deepEqual(result.errors, ['第 2 個動作「llm_reply」不是系統提供的動作，請刪除']);
});

test('Disabling a rule that contains an unsupported action：只改啟用狀態或名稱照常成功；改動作才驗證', async () => {
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
    /不是系統提供的動作/,
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
