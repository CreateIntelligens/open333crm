import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTOMATION_EVENT_DEFINITIONS,
  AUTOMATION_EVENT_NAMES,
  composeAutomationContract,
  validateAutomationRuleContract,
} from '@open333crm/automation';
import { createRule } from '#src/modules/automation/automation.service.js';
import { repoRoot } from '#tests/support/paths.js';

import { test } from 'vitest';
async function testComposerOutputByEvent() {
  const message = composeAutomationContract(AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED);
  assert.ok(message);
  assert.ok(message.facts.some((fact) => fact.key === 'message.text'));
  assert.ok(message.facts.some((fact) => fact.key === 'conversation.status'));
  assert.equal(message.facts.some((fact) => fact.key === 'case.status'), false);

  const caseCreated = composeAutomationContract(AUTOMATION_EVENT_NAMES.CASE_CREATED);
  assert.ok(caseCreated);
  assert.ok(caseCreated.facts.some((fact) => fact.key === 'case.status'));
  assert.equal(caseCreated.facts.some((fact) => fact.key === 'message.text'), false);

  const sla = composeAutomationContract(AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_BREACHED);
  assert.ok(sla);
  assert.ok(sla.facts.some((fact) => fact.key === 'sla.overdueMinutes'));
  assert.ok(sla.facts.some((fact) => fact.key === 'case.priority'));
  assert.equal(sla.facts.some((fact) => fact.key === 'message.text'), false);
}

async function testResolverDefaultExclusion() {
  const message = composeAutomationContract(AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED);
  assert.ok(message);
  assert.equal(message.scopes.includes('case'), false);
  assert.equal(message.facts.some((fact) => fact.key === 'case.priority'), false);
}

async function testValidationRejectsIncompatibleFacts() {
  const invalidCaseRule = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.CASE_CREATED,
    conditions: {
      all: [{ fact: 'message.text', operator: 'contains', value: 'refund' }],
    },
    actions: [{ type: 'notify', params: { message: 'case created' } }],
  });
  assert.equal(invalidCaseRule.valid, false);
  assert.deepEqual(invalidCaseRule.errors, ['第 1 個條件的欄位「訊息內容」不適用於「工單建立」觸發']);

  const invalidMessageRule = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED,
    conditions: {
      all: [{ fact: 'case.priority', operator: 'equal', value: 'URGENT' }],
    },
    actions: [{ type: 'notify', params: { message: 'message received' } }],
  });
  assert.equal(invalidMessageRule.valid, false);
  assert.deepEqual(invalidMessageRule.errors, ['第 1 個條件的欄位「案件優先級」不適用於「收到訊息」觸發']);
}

async function testValidationRejectsIncompatibleActions() {
  const invalid = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.CASE_CLOSED,
    conditions: {
      all: [{ fact: 'case.status', operator: 'equal', value: 'CLOSED' }],
    },
    actions: [{ type: 'send_message', params: { text: 'closed' } }],
  });

  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.errors, ['第 1 個動作「傳送訊息」不適用於「工單關閉」觸發']);
}

/** 錯誤訊息原本是英文技術訊息（actions[1].type is not allowed for message.received: auto_assign），管理員看不懂 */
async function testValidationErrorNamesUnknownFact() {
  const result = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED,
    conditions: { all: [{ fact: 'contact.vipLevel', operator: 'equal', value: 1 }] },
    actions: [],
  });
  assert.deepEqual(result.errors, ['第 1 個條件的欄位「contact.vipLevel」不是系統提供的欄位，請刪除']);
}

async function testValidationErrorUsesChineseLabels() {
  const result = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED,
    conditions: {
      all: [
        { fact: 'case.open.count', operator: 'equal', value: 0 },
        { fact: 'message.text', operator: 'contains' },
      ],
    },
    actions: [
      { type: 'create_case', params: { title: '一般問題' } },
      { type: 'auto_assign', params: {} },
      { type: 'add_tag', params: {} },
    ],
  });
  assert.deepEqual(result.errors, [
    '第 2 個條件「訊息內容」使用「包含」時必須填寫值',
    '第 2 個動作「auto_assign」不是系統提供的動作，請刪除',
    '第 3 個動作「新增標籤」必須填寫「標籤名稱」',
  ]);
  for (const error of result.errors) {
    assert.doesNotMatch(error.replace('auto_assign', ''), /[A-Za-z]/, error);
  }
}

async function testApiCreateRuleRejectsInvalidContractBeforeWrite() {
  let createCalled = false;
  const prisma = {
    automationRule: {
      create() {
        createCalled = true;
        throw new Error('should not create invalid rule');
      },
    },
  };

  await assert.rejects(
    () =>
      createRule(prisma as any, 'tenant-1', {
        name: 'invalid case rule',
        trigger: { type: AUTOMATION_EVENT_NAMES.CASE_CREATED },
        conditions: {
          all: [{ fact: 'message.text', operator: 'contains', value: 'refund' }],
        },
        actions: [{ type: 'notify', params: { message: 'invalid' } }],
      }),
    /自動化規則設定有誤/,
  );

  assert.equal(createCalled, false);
}

async function testFrontendUsesComposerMetadata() {
  const pagePath = resolve(
    repoRoot,
    'apps/web/src/app/dashboard/automation/[ruleId]/page.tsx',
  );
  const actionListPath = resolve(
    repoRoot,
    'apps/web/src/components/automation/ActionList.tsx',
  );
  const pageSource = await readFile(pagePath, 'utf8');
  const actionListSource = await readFile(actionListPath, 'utf8');

  assert.equal(pageSource.includes('getAutomationFieldOptionsForEvent'), true);
  assert.equal(pageSource.includes('getAutomationActionOptionsForEvent'), true);
  assert.equal(actionListSource.includes('actionDefinitions'), true);
}

/*
 * 這 6 種事件沒有送進 automation queue（AUDIT AUTO-05），以它們觸發的規則永遠不會執行；
 * 編輯器要能從契約知道，標示「目前不會觸發」。其餘事件都要有給管理員看的說明。
 */
test('Event that never triggers：契約標出不會觸發的事件，每個事件都有說明', () => {
  const notDispatched = AUTOMATION_EVENT_DEFINITIONS.filter((e) => e.dispatched === false).map((e) => e.name).sort();
  assert.deepEqual(notDispatched, [
    'case.assigned',
    'case.closed',
    'case.status_changed',
    'case.updated',
    'contact.updated',
    'message.postback',
  ]);
  for (const event of AUTOMATION_EVENT_DEFINITIONS) {
    assert.ok(event.description && event.description.length >= 8, `${event.name} 缺少說明`);
  }
});

/* 指派客服的參數原本是 string，前端用 key 名稱特判；改成 agent 型別，由型別決定用客服選單 */
test('指派客服的參數型別是 agent', async () => {
  const { AUTOMATION_ACTION_MAP } = await import('@open333crm/automation');
  assert.equal(AUTOMATION_ACTION_MAP.get('assign_agent')?.params?.[0]?.type, 'agent');
});

test('composer output by event', testComposerOutputByEvent);
test('resolver default exclusion', testResolverDefaultExclusion);
test('validation rejects incompatible facts', testValidationRejectsIncompatibleFacts);
test('validation rejects incompatible actions', testValidationRejectsIncompatibleActions);
test('validation error uses chinese labels', testValidationErrorUsesChineseLabels);
test('validation error names unknown fact', testValidationErrorNamesUnknownFact);
test('api create rule rejects invalid contract before write', testApiCreateRuleRejectsInvalidContractBeforeWrite);
test('frontend uses composer metadata', testFrontendUsesComposerMetadata);
