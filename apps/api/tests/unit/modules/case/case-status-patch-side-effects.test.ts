/**
 * 用狀態下拉（PATCH /cases/:id）改狀態，要和頂部按鈕走同一條路徑（S06）：
 * 寫時間軸事件，並發布 case.resolved／case.closed／case.escalated 給 CSAT、自動化與升級通知。
 * spec case-management「Case Status Transition Validation」「Escalation Notifies The Selected Targets」。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updateCaseFlow } from '#src/modules/case/case.flow.js';
import type { RequestActor } from '#src/lib/request-actor.js';
import { createFlowLog, mockTransactionPrisma, recordingIo, recordingPublisher } from '#tests/support/flow-harness.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const actor: RequestActor = { tenantId: TENANT_ID, agentId: 'agent-1', roleId: null, ip: '127.0.0.1' };

function setup(status: string) {
  let row: Record<string, unknown> = {
    id: 'case-1',
    tenantId: TENANT_ID,
    contactId: 'contact-1',
    channelId: 'channel-1',
    title: '冷氣不冷',
    status,
    priority: 'MEDIUM',
    assigneeId: 'agent-2',
    teamId: null,
    conversations: [{ id: 'conv-1' }],
  };
  const caseEvents: Array<{ eventType: string; actorId?: string; payload: Record<string, unknown> }> = [];
  const tx = {
    case: {
      async findFirst() {
        return { ...row };
      },
      async update({ data }: { data: Record<string, unknown> }) {
        row = { ...row, ...data };
        return { ...row, contact: null, assignee: null, team: null };
      },
    },
    caseEvent: {
      async create({ data }: { data: { eventType: string; actorId?: string; payload: Record<string, unknown> } }) {
        caseEvents.push(data);
        return data;
      },
    },
  };
  const log = createFlowLog();
  const deps = { prisma: mockTransactionPrisma(log, tx), io: recordingIo(log), events: recordingPublisher(log) };
  const update = (data: Parameters<typeof updateCaseFlow>[3]) => updateCaseFlow(deps, actor, 'case-1', data);
  return {
    update,
    caseEvents,
    get published() { return log.events; },
    get emitted() { return log.pushes.map((p) => p.event); },
    get row() { return row; },
  };
}

test('下拉改成已解決：寫 status_changed 事件並發布 case.resolved', async () => {
  const s = setup('IN_PROGRESS');
  const result = await s.update({ status: 'RESOLVED' });

  assert.equal(result.status, 'RESOLVED');
  assert.deepEqual(
    s.caseEvents.map((e) => [e.eventType, e.actorId, e.payload.from, e.payload.to]),
    [['status_changed', 'agent-1', 'IN_PROGRESS', 'RESOLVED']],
  );
  const resolved = s.published.find((e) => e.name === 'case.resolved');
  assert.ok(resolved, '應發布 case.resolved（CSAT 與自動化依此觸發）');
  assert.equal(resolved.payload.conversationId, 'conv-1');
});

test('下拉改成已關閉：寫 status_changed 事件並發布 case.closed', async () => {
  const s = setup('RESOLVED');
  await s.update({ status: 'CLOSED' });

  assert.deepEqual(s.caseEvents.map((e) => e.eventType), ['status_changed']);
  assert.ok(s.published.some((e) => e.name === 'case.closed'));
});

test('下拉改成已升級：寫 escalated 事件並發布 case.escalated（通知主管）', async () => {
  const s = setup('IN_PROGRESS');
  await s.update({ status: 'ESCALATED' });

  assert.deepEqual(s.caseEvents.map((e) => e.eventType), ['escalated']);
  const escalated = s.published.find((e) => e.name === 'case.escalated');
  assert.ok(escalated, '應發布 case.escalated');
  assert.equal(escalated.payload.actorId, 'agent-1');
  assert.equal(escalated.payload.previousAssigneeId, 'agent-2');
});

test('同時改標題與狀態：標題照存，狀態走轉換路徑', async () => {
  const s = setup('IN_PROGRESS');
  await s.update({ title: '新標題', status: 'PENDING' });

  assert.equal(s.row.title, '新標題');
  assert.equal(s.row.status, 'PENDING');
  assert.deepEqual(s.caseEvents.map((e) => e.eventType), ['status_changed']);
});

test('只改標題：不寫狀態事件、不發布狀態事件', async () => {
  const s = setup('IN_PROGRESS');
  await s.update({ title: '新標題' });

  assert.equal(s.caseEvents.length, 0);
  assert.ok(!s.published.some((e) => e.name.startsWith('case.')));
  assert.deepEqual(s.emitted, ['case.updated']);
});

test('同時改標題與不合法的狀態：回 422，標題不會先被存起來', async () => {
  const s = setup('OPEN');
  await assert.rejects(
    () => s.update({ title: '新標題', status: 'RESOLVED' }),
    (err: { code?: string; statusCode?: number }) => err.code === 'INVALID_TRANSITION' && err.statusCode === 422,
  );

  assert.equal(s.row.title, '冷氣不冷');
  assert.equal(s.row.status, 'OPEN');
  assert.equal(s.caseEvents.length, 0);
  assert.deepEqual(s.emitted, []);
});
