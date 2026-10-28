/**
 * case 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：
 * - 推播在 commit 之後送出，rollback 時丟棄（主規格 tenant-transaction-context）。
 * - 事件與資料在同一個交易寫進 outbox（主規格 event-delivery）。
 * - 刪除工單的稽核與刪除一起 commit；稽核寫入失敗時整筆 rollback（主規格 tenant-audit-log）。
 * - 建立工單之後的自動派案，在 commit 之後另開一個交易；派案失敗不影響已建立的工單。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { RequestActor } from '#src/lib/request-actor.js';
import {
  assignCaseFlow,
  createCaseFlow,
  deleteCaseFlow,
  linkConversationToCaseFlow,
  transitionCaseFlow,
} from '#src/modules/case/case.flow.js';
import { createFlowLog, mockTransactionPrisma, recordingIo, recordingPublisher, type FlowLog } from '#tests/support/flow-harness.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const actor: RequestActor = { tenantId: TENANT_ID, agentId: 'agent-1', roleId: null, ip: '127.0.0.1' };

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    tenantId: TENANT_ID,
    contactId: 'contact-1',
    channelId: 'channel-1',
    title: '冷氣不冷',
    status: 'OPEN',
    priority: 'MEDIUM',
    assigneeId: null,
    teamId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    conversations: [{ id: 'conv-1' }],
    ...overrides,
  };
}

function depsOf(log: FlowLog, tx: Record<string, unknown>) {
  return { prisma: mockTransactionPrisma(log, tx), io: recordingIo(log), events: recordingPublisher(log) };
}

/** 建立工單用的 tx。teamId 有值時會自動派案；autoAssign 'fail' 時派案的查詢丟出錯誤 */
function createCaseTx(log: FlowLog, opts: { teamId?: string | null; autoAssign?: 'ok' | 'fail' } = {}) {
  return {
    channelIdentity: { findFirst: async () => ({ id: 'identity-1' }) },
    slaPolicy: { findFirst: async () => null },
    case: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        log.entries.push('write:case');
        return { ...caseRow(), ...data, id: 'case-1', contact: null, assignee: null };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        log.entries.push(`write:case:${data.status}`);
        return { ...caseRow(), ...data, teamId: opts.teamId ?? null };
      },
    },
    caseEvent: {
      create: async ({ data }: { data: { eventType: string } }) => {
        log.entries.push(`write:caseEvent:${data.eventType}`);
        return data;
      },
    },
    broadcastRecipient: { findFirst: async () => null },
    agent: {
      findMany: async () => {
        if (opts.autoAssign === 'fail') throw new Error('db hiccup');
        return [{ id: 'agent-9', name: '小美', _count: { assignedCases: 0 } }];
      },
    },
  };
}

const createInput = { contactId: 'contact-1', channelId: 'channel-1', title: '冷氣不冷' };

test('建立工單：事件與工單一起寫入，commit 之後才推播 case.created', async () => {
  const log = createFlowLog();
  const created = await createCaseFlow(depsOf(log, createCaseTx(log)), actor, createInput);

  assert.equal(created.id, 'case-1');
  assert.deepEqual(log.entries.slice(0, 6), [
    'write:case',
    'write:caseEvent:created',
    'event:case.created',
    'commit',
    'push:case.created',
    'dispatch:case.created',
  ]);
  assert.deepEqual(log.events[0], {
    name: 'case.created',
    payload: {
      caseId: 'case-1',
      contactId: 'contact-1',
      channelId: 'channel-1',
      title: '冷氣不冷',
      priority: 'MEDIUM',
      status: 'OPEN',
    },
  });
  assert.equal(log.pushes[0].room, `tenant:${TENANT_ID}`);
});

test('建立工單時有團隊、沒有負責人：commit 之後另開交易自動派案，推播帶 source', async () => {
  const log = createFlowLog();
  await createCaseFlow(depsOf(log, createCaseTx(log, { teamId: 'team-1' })), actor, { ...createInput, teamId: 'team-1' });

  // case.created 的推播在建立工單的交易 commit 之後才送出，所以派案要排在它之後
  const createdPushed = log.entries.indexOf('push:case.created');
  const assigned = log.entries.indexOf('write:case:IN_PROGRESS');
  assert.ok(createdPushed >= 0 && assigned > createdPushed, '派案在建立工單的交易 commit 之後才寫入');
  assert.deepEqual(log.entries.slice(assigned), [
    'write:case:IN_PROGRESS',
    'write:caseEvent:auto_assigned',
    'event:case.assigned',
    'commit',
    'push:case.updated',
    'dispatch:case.assigned',
  ]);
  const push = log.pushes.find((p) => p.event === 'case.updated');
  assert.deepEqual(push?.data, { id: 'case-1', status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeId: 'agent-9', source: 'auto_assign' });
  assert.deepEqual(log.events.find((e) => e.name === 'case.assigned')?.payload, {
    caseId: 'case-1',
    assigneeId: 'agent-9',
    title: '冷氣不冷',
    source: 'auto_assign',
  });
});

test('自動派案失敗：工單照樣建立並推播，派案的交易 rollback', async () => {
  const log = createFlowLog();
  const created = await createCaseFlow(
    depsOf(log, createCaseTx(log, { teamId: 'team-1', autoAssign: 'fail' })),
    actor,
    { ...createInput, teamId: 'team-1' },
  );

  assert.equal(created.id, 'case-1');
  assert.ok(log.entries.includes('push:case.created'));
  assert.equal(log.entries.at(-1), 'rollback');
  assert.ok(!log.events.some((e) => e.name === 'case.assigned'));
});

test('指定了負責人：不自動派案', async () => {
  const log = createFlowLog();
  await createCaseFlow(depsOf(log, createCaseTx(log, { teamId: 'team-1' })), actor, {
    ...createInput,
    teamId: 'team-1',
    assigneeId: 'agent-2',
  });
  assert.ok(!log.entries.includes('write:case:IN_PROGRESS'));
});

test('結案：commit 之後推播 case.updated，並發 case.resolved 帶上對話 ID', async () => {
  const log = createFlowLog();
  const tx = {
    case: {
      findFirst: async () => caseRow({ status: 'IN_PROGRESS', assigneeId: 'agent-2' }),
      update: async () => ({ ...caseRow({ status: 'RESOLVED', assigneeId: 'agent-2' }), contact: null, assignee: null }),
    },
    caseEvent: { create: async () => ({}) },
  };
  const updated = await transitionCaseFlow(depsOf(log, tx), actor, 'case-1', 'RESOLVED');

  assert.equal(updated.status, 'RESOLVED');
  assert.deepEqual(log.entries, ['event:case.resolved', 'commit', 'push:case.updated', 'dispatch:case.resolved']);
  assert.deepEqual(log.events[0].payload, {
    caseId: 'case-1',
    contactId: 'contact-1',
    channelId: 'channel-1',
    assigneeId: 'agent-2',
    title: '冷氣不冷',
    conversationId: 'conv-1',
  });
});

test('重啟：只推播，不發事件', async () => {
  const log = createFlowLog();
  const tx = {
    case: {
      findFirst: async () => caseRow({ status: 'CLOSED' }),
      update: async () => ({ ...caseRow({ status: 'OPEN' }), contact: null, assignee: null }),
    },
    caseEvent: { create: async () => ({}) },
  };
  await transitionCaseFlow(depsOf(log, tx), actor, 'case-1', 'OPEN');
  assert.deepEqual(log.entries, ['commit', 'push:case.updated']);
});

test('手動指派：commit 之後推播，並發 case.assigned（不帶 source）', async () => {
  const log = createFlowLog();
  const tx = {
    case: {
      findFirst: async () => caseRow(),
      update: async () => ({ ...caseRow({ status: 'IN_PROGRESS', assigneeId: 'agent-2' }), assignee: null }),
    },
    agent: { findFirst: async () => ({ id: 'agent-2', name: '阿明' }) },
    caseEvent: { create: async () => ({}) },
  };
  await assignCaseFlow(depsOf(log, tx), actor, 'case-1', 'agent-2');

  assert.deepEqual(log.entries, ['event:case.assigned', 'commit', 'push:case.updated', 'dispatch:case.assigned']);
  assert.deepEqual(log.events[0].payload, { caseId: 'case-1', assigneeId: 'agent-2', title: '冷氣不冷' });
});

test('對話掛到工單：commit 之後推播 case.updated，內容只有工單與對話 ID', async () => {
  const log = createFlowLog();
  const tx = {
    case: { findFirst: async () => caseRow() },
    conversation: {
      findFirst: async () => ({ id: 'conv-2', tenantId: TENANT_ID, caseId: null }),
      update: async () => ({ id: 'conv-2', caseId: 'case-1' }),
    },
    caseEvent: { create: async () => ({}) },
    message: { findFirst: async () => null },
  };
  await linkConversationToCaseFlow(depsOf(log, tx), actor, 'case-1', 'conv-2');

  assert.deepEqual(log.entries, ['commit', 'push:case.updated']);
  assert.deepEqual(log.pushes[0].data, { id: 'case-1', conversationId: 'conv-2' });
});

function deleteTx(log: FlowLog, audit: 'ok' | 'fail') {
  return {
    case: {
      findFirst: async () => caseRow(),
      delete: async () => {
        log.entries.push('delete:case');
        return {};
      },
    },
    conversation: { updateMany: async () => ({ count: 1 }) },
    tenantAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (audit === 'fail') throw new Error('audit write failed');
        log.entries.push(`audit:${data.action}:${data.tenantId}:${data.actorId}:${data.targetId}`);
        return data;
      },
    },
  };
}

test('刪除工單：稽核與刪除一起 commit，commit 之後才推播 case.deleted', async () => {
  const log = createFlowLog();
  const result = await deleteCaseFlow(depsOf(log, deleteTx(log, 'ok')), actor, 'case-1');

  assert.deepEqual(result, { id: 'case-1' });
  assert.deepEqual(log.entries, [
    'delete:case',
    `audit:case.delete:${TENANT_ID}:agent-1:case-1`,
    'commit',
    'push:case.deleted',
  ]);
});

test('刪除工單時稽核寫入失敗：整筆 rollback，不推播', async () => {
  const log = createFlowLog();
  await assert.rejects(() => deleteCaseFlow(depsOf(log, deleteTx(log, 'fail')), actor, 'case-1'), /audit write failed/);

  assert.deepEqual(log.entries, ['delete:case', 'rollback']);
  assert.equal(log.pushes.length, 0);
});
