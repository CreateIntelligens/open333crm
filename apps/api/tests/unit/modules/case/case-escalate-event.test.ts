/**
 * 升級工單的 case.escalated 事件要帶上通知 worker 決定收件人所需的欄位
 * （change fix-w6-field-validation，spec case-management「Escalation Notifies The Selected Targets」）。
 * 收件人怎麼算見 tests/unit/modules/notification/escalation-recipients.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { escalateCaseFlow } from '#src/modules/case/case.flow.js';
import type { RequestActor } from '#src/lib/request-actor.js';
import { createFlowLog, mockTransactionPrisma, recordingIo, recordingPublisher } from '#tests/support/flow-harness.js';

const T = 'a0000000-0000-0000-0000-000000000001';

const caseRecord = {
  id: 'case-1',
  tenantId: T,
  contactId: 'contact-1',
  channelId: 'channel-1',
  status: 'IN_PROGRESS',
  priority: 'MEDIUM',
  assigneeId: 'agent-b',
};

const tx = {
  case: {
    findFirst: async () => caseRecord,
    update: async () => ({ ...caseRecord, status: 'ESCALATED', priority: 'HIGH', contact: null, assignee: null }),
  },
  caseEvent: { create: async () => ({}) },
  agent: { findFirst: async () => null },
};
const actor: RequestActor = { tenantId: T, agentId: 'agent-a', roleId: null, ip: '127.0.0.1' };

/** 升級工單，回傳寫進 outbox 的 case.escalated */
async function escalate(body: Parameters<typeof escalateCaseFlow>[3]) {
  const log = createFlowLog();
  const deps = { prisma: mockTransactionPrisma(log, tx), io: recordingIo(log), events: recordingPublisher(log) };
  await escalateCaseFlow(deps, actor, 'case-1', body);
  return log.events.filter((e) => e.name === 'case.escalated');
}

test('事件帶上 notifyTargets、升級前的指派人與升級的客服', async () => {
  const captured = await escalate({
    reason: 'ci',
    newPriority: 'HIGH',
    notifyTargets: ['original_assignee'],
  });
  assert.equal(captured.length, 1);
  const payload = captured[0].payload;
  assert.deepEqual(payload.notifyTargets, ['original_assignee']);
  assert.equal(payload.previousAssigneeId, 'agent-b');
  assert.equal(payload.actorId, 'agent-a');
});

test('沒帶 notifyTargets 時事件的 notifyTargets 為 undefined（worker 只通知主管）', async () => {
  const captured = await escalate({ reason: 'ci', newPriority: 'HIGH' });
  assert.equal(captured[0].payload.notifyTargets, undefined);
});
