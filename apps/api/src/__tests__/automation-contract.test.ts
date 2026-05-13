import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTOMATION_EVENT_NAMES,
  composeAutomationContract,
  validateAutomationRuleContract,
} from '@open333crm/automation';
import { createRule } from '../modules/automation/automation.service.js';

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
  assert.ok(invalidCaseRule.errors.some((error) => error.includes('message.text')));

  const invalidMessageRule = validateAutomationRuleContract({
    eventName: AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED,
    conditions: {
      all: [{ fact: 'case.priority', operator: 'equal', value: 'URGENT' }],
    },
    actions: [{ type: 'notify', params: { message: 'message received' } }],
  });
  assert.equal(invalidMessageRule.valid, false);
  assert.ok(invalidMessageRule.errors.some((error) => error.includes('case.priority')));
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
  assert.ok(invalid.errors.some((error) => error.includes('send_message')));
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
    /Invalid automation rule contract/,
  );

  assert.equal(createCalled, false);
}

async function testFrontendUsesComposerMetadata() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const pagePath = resolve(
    here,
    '../../../web/src/app/dashboard/automation/[ruleId]/page.tsx',
  );
  const actionListPath = resolve(
    here,
    '../../../web/src/components/automation/ActionList.tsx',
  );
  const pageSource = await readFile(pagePath, 'utf8');
  const actionListSource = await readFile(actionListPath, 'utf8');

  assert.equal(pageSource.includes('getAutomationFieldOptionsForEvent'), true);
  assert.equal(pageSource.includes('getAutomationActionOptionsForEvent'), true);
  assert.equal(actionListSource.includes('actionDefinitions'), true);
}

await testComposerOutputByEvent();
await testResolverDefaultExclusion();
await testValidationRejectsIncompatibleFacts();
await testValidationRejectsIncompatibleActions();
await testApiCreateRuleRejectsInvalidContractBeforeWrite();
await testFrontendUsesComposerMetadata();

console.log('automation-contract tests passed');
