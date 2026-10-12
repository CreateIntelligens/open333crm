/**
 * 升級工單的 case.escalated 事件要帶上通知 worker 決定收件人所需的欄位
 * （change fix-w6-field-validation，spec case-management「Escalation Notifies The Selected Targets」）。
 * 收件人怎麼算見 tests/unit/modules/notification/escalation-recipients.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { escalateCase } from '#src/modules/case/case.service.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';

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

const db = {
  case: {
    findFirst: async () => caseRecord,
    update: async () => ({ ...caseRecord, status: 'ESCALATED', priority: 'HIGH', contact: null, assignee: null }),
  },
  caseEvent: { create: async () => ({}) },
  agent: { findFirst: async () => null },
} as never;
const io = { to: () => ({ emit: () => {} }) } as never;

let captured: AppEvent[] = [];
const handler = (e: AppEvent) => captured.push(e);
afterEach(() => {
  eventBus.unsubscribe('case.escalated', handler);
  captured = [];
});

test('事件帶上 notifyTargets、升級前的指派人與升級的客服', async () => {
  eventBus.subscribe('case.escalated', handler);
  await escalateCase(db, io, 'case-1', T, 'agent-a', {
    reason: 'ci',
    newPriority: 'HIGH',
    notifyTargets: ['original_assignee'],
  });
  assert.equal(captured.length, 1);
  const payload = captured[0].payload as Record<string, unknown>;
  assert.deepEqual(payload.notifyTargets, ['original_assignee']);
  assert.equal(payload.previousAssigneeId, 'agent-b');
  assert.equal(payload.actorId, 'agent-a');
});

test('沒帶 notifyTargets 時事件的 notifyTargets 為 undefined（worker 只通知主管）', async () => {
  eventBus.subscribe('case.escalated', handler);
  await escalateCase(db, io, 'case-1', T, 'agent-a', { reason: 'ci', newPriority: 'HIGH' });
  assert.equal((captured[0].payload as Record<string, unknown>).notifyTargets, undefined);
});
