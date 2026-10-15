/**
 * 用狀態下拉（PATCH /cases/:id）改狀態，要和頂部按鈕走同一條路徑（S06）：
 * 寫時間軸事件，並發布 case.resolved／case.closed／case.escalated 給 CSAT、自動化與升級通知。
 * spec case-management「Case Status Transition Validation」「Escalation Notifies The Selected Targets」。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { updateCase } from '#src/modules/case/case.service.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

let published: AppEvent[];
const listener = (e: AppEvent) => published.push(e);
beforeEach(() => {
  published = [];
  eventBus.subscribe('*', listener);
});
afterEach(() => eventBus.unsubscribe('*', listener));

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
  const emitted: string[] = [];
  const prisma = {
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
  const io = { to: () => ({ emit: (event: string) => emitted.push(event) }) };
  return { prisma, io, caseEvents, emitted, get row() { return row; } };
}

test('下拉改成已解決：寫 status_changed 事件並發布 case.resolved', async () => {
  const s = setup('IN_PROGRESS');
  const result = await updateCase(s.prisma as never, s.io as never, 'case-1', TENANT_ID, { status: 'RESOLVED' }, { actorId: 'agent-1' });

  assert.equal(result.status, 'RESOLVED');
  assert.deepEqual(
    s.caseEvents.map((e) => [e.eventType, e.actorId, e.payload.from, e.payload.to]),
    [['status_changed', 'agent-1', 'IN_PROGRESS', 'RESOLVED']],
  );
  const resolved = published.find((e) => e.name === 'case.resolved');
  assert.ok(resolved, '應發布 case.resolved（CSAT 與自動化依此觸發）');
  assert.equal(resolved.payload.conversationId, 'conv-1');
});

test('下拉改成已關閉：寫 status_changed 事件並發布 case.closed', async () => {
  const s = setup('RESOLVED');
  await updateCase(s.prisma as never, s.io as never, 'case-1', TENANT_ID, { status: 'CLOSED' }, { actorId: 'agent-1' });

  assert.deepEqual(s.caseEvents.map((e) => e.eventType), ['status_changed']);
  assert.ok(published.some((e) => e.name === 'case.closed'));
});

test('下拉改成已升級：寫 escalated 事件並發布 case.escalated（通知主管）', async () => {
  const s = setup('IN_PROGRESS');
  await updateCase(s.prisma as never, s.io as never, 'case-1', TENANT_ID, { status: 'ESCALATED' }, { actorId: 'agent-1' });

  assert.deepEqual(s.caseEvents.map((e) => e.eventType), ['escalated']);
  const escalated = published.find((e) => e.name === 'case.escalated');
  assert.ok(escalated, '應發布 case.escalated');
  assert.equal(escalated.payload.actorId, 'agent-1');
  assert.equal(escalated.payload.previousAssigneeId, 'agent-2');
});

test('同時改標題與狀態：標題照存，狀態走轉換路徑', async () => {
  const s = setup('IN_PROGRESS');
  await updateCase(s.prisma as never, s.io as never, 'case-1', TENANT_ID, { title: '新標題', status: 'PENDING' }, { actorId: 'agent-1' });

  assert.equal(s.row.title, '新標題');
  assert.equal(s.row.status, 'PENDING');
  assert.deepEqual(s.caseEvents.map((e) => e.eventType), ['status_changed']);
});

test('只改標題：不寫狀態事件、不發布狀態事件', async () => {
  const s = setup('IN_PROGRESS');
  await updateCase(s.prisma as never, s.io as never, 'case-1', TENANT_ID, { title: '新標題' }, { actorId: 'agent-1' });

  assert.equal(s.caseEvents.length, 0);
  assert.ok(!published.some((e) => e.name.startsWith('case.')));
  assert.deepEqual(s.emitted, ['case.updated']);
});
