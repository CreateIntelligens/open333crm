/**
 * PATCH /conversations/:id 帶 status=CLOSED 時，和 POST /:id/close 走同一條結案流程（AUDIT CONV-02）。
 * 修正前 updateConversation() 只改 status：不記結案來源、時間與結案人，也不發布 conversation.closed。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updateConversation } from '#src/modules/conversation/conversation.service.js';
import { eventBus } from '#src/events/event-bus.js';

function fixture(status: string) {
  const state: Record<string, unknown> = {
    id: 'c1',
    tenantId: 't1',
    status,
    assignedToId: 'agent-a',
    unreadCount: 0,
    lastMessageAt: null,
    metadata: { existing: 1 },
  };
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    conversation: {
      findFirst: async () => ({ ...state }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        const { assignedTo, ...rest } = args.data as { assignedTo?: { connect?: { id: string }; disconnect?: boolean } };
        Object.assign(state, rest);
        if (assignedTo) state.assignedToId = assignedTo.connect?.id ?? null;
        return { ...state, updatedAt: new Date() };
      },
    },
  } as never;
  const io = { to: () => ({ emit() {} }) } as never;
  return { prisma, io, state, updates };
}

function captureClosed() {
  const events: Array<{ payload: Record<string, unknown> }> = [];
  const original = eventBus.publish.bind(eventBus);
  (eventBus as { publish: unknown }).publish = (e: { name: string; payload: Record<string, unknown> }) => {
    if (e.name === 'conversation.closed') events.push(e);
  };
  return { events, restore: () => { (eventBus as { publish: unknown }).publish = original; } };
}

test('PATCH 把對話改成 CLOSED：記錄結案來源、時間與結案人，並發布 conversation.closed', async () => {
  const f = fixture('AGENT_HANDLED');
  const cap = captureClosed();
  try {
    await updateConversation(f.prisma, f.io, 'c1', 't1', { status: 'CLOSED' }, { actorId: 'agent-b' });
  } finally {
    cap.restore();
  }
  assert.equal(f.state.status, 'CLOSED');
  const meta = f.state.metadata as Record<string, unknown>;
  assert.equal(meta.existing, 1, '保留既有 metadata');
  assert.equal(meta.closeSource, 'manual');
  assert.equal(meta.closedById, 'agent-b');
  assert.equal(meta.closeReason, null);
  assert.ok(typeof meta.closedAt === 'string');
  assert.equal(cap.events.length, 1);
  assert.equal(cap.events[0].payload.closedById, 'agent-b');
});

test('PATCH 同時改負責人與 CLOSED：負責人照改，結案資料照記', async () => {
  const f = fixture('ACTIVE');
  const cap = captureClosed();
  try {
    await updateConversation(f.prisma, f.io, 'c1', 't1', { status: 'CLOSED', assignedToId: 'agent-c' }, { actorId: 'agent-b' });
  } finally {
    cap.restore();
  }
  assert.equal(f.state.assignedToId, 'agent-c');
  assert.equal(f.state.status, 'CLOSED');
  assert.equal((f.state.metadata as Record<string, unknown>).closeSource, 'manual');
  assert.equal(cap.events.length, 1);
});

test('已結案的對話再 PATCH CLOSED：不重記結案資料、不重發事件', async () => {
  const f = fixture('CLOSED');
  const cap = captureClosed();
  try {
    await updateConversation(f.prisma, f.io, 'c1', 't1', { status: 'CLOSED' }, { actorId: 'agent-b' });
  } finally {
    cap.restore();
  }
  assert.equal((f.state.metadata as Record<string, unknown>).closeSource, undefined);
  assert.equal(cap.events.length, 0);
});

test('PATCH 改成 CLOSED 以外的狀態：只改狀態，不寫結案資料', async () => {
  const f = fixture('ACTIVE');
  const cap = captureClosed();
  try {
    await updateConversation(f.prisma, f.io, 'c1', 't1', { status: 'AGENT_HANDLED' }, { actorId: 'agent-b' });
  } finally {
    cap.restore();
  }
  assert.equal(f.state.status, 'AGENT_HANDLED');
  assert.equal((f.state.metadata as Record<string, unknown>).closeSource, undefined);
  assert.equal(cap.events.length, 0);
});
