import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRules } from '@open333crm/automation';
import {
  SLA_EVENT_NAMES,
  buildSlaFacts,
  bumpSlaPriority,
  getSlaConditionFactsForEvent,
  getSlaState,
  validateSlaRuleConditionTree,
} from '@open333crm/shared';
import { apiSrc, repoRoot } from '#tests/support/paths.js';

import { test } from 'vitest';
async function testSlaContractMetadata() {
  const facts = getSlaConditionFactsForEvent(SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED);
  assert.ok(facts.some((fact) => fact.key === 'case.customerMessagesSinceLastAgentReply'));
  assert.ok(!facts.some((fact) => fact.key === 'message.text'));
}

async function testSlaHelpers() {
  const dueAt = new Date('2026-05-12T10:00:00Z');

  assert.equal(
    getSlaState(dueAt, 30, new Date('2026-05-12T09:20:00Z')),
    'normal',
  );
  assert.equal(
    getSlaState(dueAt, 30, new Date('2026-05-12T09:45:00Z')),
    'warning',
  );
  assert.equal(
    getSlaState(dueAt, 30, new Date('2026-05-12T10:01:00Z')),
    'breached',
  );
  assert.equal(bumpSlaPriority('MEDIUM'), 'HIGH');
}

async function testSlaRuleValidation() {
  const valid = validateSlaRuleConditionTree(SLA_EVENT_NAMES.RESOLUTION_BREACHED, {
    all: [
      { fact: 'sla.overdueMinutes', operator: 'greaterThanInclusive', value: 0 },
      { fact: 'case.priority', operator: 'notEqual', value: 'URGENT' },
    ],
  });

  assert.equal(valid.valid, true);

  const invalid = validateSlaRuleConditionTree(SLA_EVENT_NAMES.RESOLUTION_BREACHED, {
    all: [{ fact: 'message.text', operator: 'contains', value: 'refund' }],
  });

  assert.equal(invalid.valid, false);
}

async function testSlaRuleEvaluation() {
  const facts = buildSlaFacts({
    caseId: 'case-1',
    tenantId: 'tenant-1',
    status: 'OPEN',
    priority: 'HIGH',
    kind: 'customer_waiting',
    state: 'breached',
    customerMessagesSinceLastAgentReply: 3,
  });

  const matched = await evaluateRules(
    [
      {
        id: 'rule-1',
        name: 'customer waiting',
        priority: 100,
        stopOnMatch: false,
        conditions: {
          all: [
            {
              fact: 'case.customerMessagesSinceLastAgentReply',
              operator: 'greaterThanInclusive',
              value: 3,
            },
          ],
        },
        actions: [{ type: 'notify_supervisor', params: { message: 'waiting' } }],
      },
    ],
    facts,
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0].ruleId, 'rule-1');
}

async function testApiStartupDoesNotRegisterSlaScanner() {
  const indexPath = resolve(apiSrc, 'index.ts');
  const source = await readFile(indexPath, 'utf8');

  assert.equal(source.includes("from './modules/sla/sla.worker.js'"), false);
  assert.equal(source.includes('setupSlaWorker('), false);
}

async function testApiAutomationSubscriberOnlyEnqueuesJobs() {
  const workerPath = resolve(apiSrc, 'modules/automation/automation.worker.ts');
  const source = await readFile(workerPath, 'utf8');

  assert.equal(source.includes("import { triggerAutomation }"), false);
  assert.equal(source.includes('await triggerAutomation('), false);
  assert.equal(source.includes("new Queue('automation'"), true);
  // 佇列改為延遲建立（automationQueue()），避免 import 時就連 Redis
  assert.match(source, /automationQueue\(\)\.add\('automation:evaluate'/);
}

async function testWorkerSlaNotificationPathsArePresent() {
  const handlerPath = resolve(repoRoot, 'apps/workers/src/handlers/sla.handler.ts');
  const source = await readFile(handlerPath, 'utf8');

  assert.equal(source.includes('enqueueNotification'), true);
  assert.equal(source.includes('first_response_warning'), true);
  assert.equal(source.includes('first_response_breached'), true);
  assert.equal(source.includes('sla_warning'), true);
  assert.equal(source.includes('sla_breached'), true);
  assert.equal(source.includes('customer_waiting_breached'), true);
  assert.equal(source.includes('message.received'), false);
}

test('sla contract metadata', testSlaContractMetadata);
test('sla helpers', testSlaHelpers);
test('sla rule validation', testSlaRuleValidation);
test('sla rule evaluation', testSlaRuleEvaluation);
test('api startup does not register sla scanner', testApiStartupDoesNotRegisterSlaScanner);
test('api automation subscriber only enqueues jobs', testApiAutomationSubscriberOnlyEnqueuesJobs);
test('worker sla notification paths are present', testWorkerSlaNotificationPathsArePresent);
