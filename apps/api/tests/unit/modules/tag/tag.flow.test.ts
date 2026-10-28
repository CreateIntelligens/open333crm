/**
 * tag 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：
 * - 貼聯絡人標籤時，contact.tagged 與貼標在同一個交易寫進 outbox，commit 之後才送出（主規格 event-delivery）。
 * - 貼標失敗時整筆 rollback，事件不送出。
 * - 工單與對話的貼標不發事件。
 * - 刪除標籤與它的所有貼標在同一個交易內；中途失敗時整筆 rollback。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { addTagToTargetFlow, deleteTagFlow } from '#src/modules/tag/tag.flow.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher, type FlowLog } from '#tests/support/flow-harness.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

function tagRow(scope: string) {
  return { id: 'tag-1', name: 'VIP', color: '#6366f1', type: 'MANUAL', scope, description: null };
}

/** 貼標用的 tx：目標都存在，標籤的範圍由 tagScope 決定 */
function tagTx(log: FlowLog, tagScope: string) {
  const upsert = (table: string) => async () => {
    log.entries.push(`write:${table}`);
    return { id: `${table}-1`, tag: tagRow(tagScope) };
  };
  return {
    contact: { findFirst: async () => ({ id: 'contact-1' }) },
    case: { findFirst: async () => ({ id: 'case-1' }) },
    conversation: { findFirst: async () => ({ id: 'conv-1' }) },
    tag: { findFirst: async () => tagRow(tagScope) },
    contactTag: { upsert: upsert('contactTag') },
    caseTag: { upsert: upsert('caseTag') },
    conversationTag: { upsert: upsert('conversationTag') },
  };
}

function depsOf(log: FlowLog, tx: Record<string, unknown>) {
  return { prisma: mockTransactionPrisma(log, tx), events: recordingPublisher(log) };
}

test('貼聯絡人標籤：contact.tagged 與貼標一起寫入，commit 之後才送出', async () => {
  const log = createFlowLog();

  await addTagToTargetFlow(depsOf(log, tagTx(log, 'CONTACT')), TENANT_ID, {
    targetType: 'CONTACT',
    targetId: 'contact-1',
    tagId: 'tag-1',
    agentId: 'agent-1',
  });

  assert.deepEqual(log.entries, ['write:contactTag', 'event:contact.tagged', 'commit', 'dispatch:contact.tagged']);
  assert.deepEqual(log.events, [
    { name: 'contact.tagged', payload: { contactId: 'contact-1', tagId: 'tag-1', tagName: 'VIP', source: 'agent' } },
  ]);
});

test('貼聯絡人標籤：source 依 addedBy（自動化以它防止迴圈）', async () => {
  const log = createFlowLog();

  await addTagToTargetFlow(depsOf(log, tagTx(log, 'CONTACT')), TENANT_ID, {
    targetType: 'CONTACT',
    targetId: 'contact-1',
    tagId: 'tag-1',
    addedBy: 'system',
  });

  assert.equal(log.events[0].payload.source, 'system');
});

test('貼工單與對話標籤：不發事件', async () => {
  for (const [targetType, scope, table] of [
    ['CASE', 'CASE', 'caseTag'],
    ['CONVERSATION', 'CONVERSATION', 'conversationTag'],
  ] as const) {
    const log = createFlowLog();
    await addTagToTargetFlow(depsOf(log, tagTx(log, scope)), TENANT_ID, {
      targetType,
      targetId: 'target-1',
      tagId: 'tag-1',
      agentId: 'agent-1',
    });
    assert.deepEqual(log.entries, [`write:${table}`, 'commit'], targetType);
  }
});

test('貼標失敗（標籤範圍不符）：rollback，事件不送出', async () => {
  const log = createFlowLog();

  await assert.rejects(
    () => addTagToTargetFlow(depsOf(log, tagTx(log, 'CASE')), TENANT_ID, {
      targetType: 'CONTACT',
      targetId: 'contact-1',
      tagId: 'tag-1',
    }),
    (err: { code?: string }) => err.code === 'TAG_SCOPE_MISMATCH',
  );

  assert.deepEqual(log.entries, ['rollback']);
});

test('刪除標籤：所有刪除在同一個交易內，最後一步失敗時整筆 rollback', async () => {
  const log = createFlowLog();
  const deleteMany = (table: string) => async () => {
    log.entries.push(`delete:${table}`);
    return { count: 1 };
  };
  const tx = {
    tag: {
      findFirst: async () => ({ id: 'tag-1', name: 'VIP', scope: 'CONTACT' }),
      delete: async () => {
        throw new Error('db hiccup');
      },
    },
    contactTag: { deleteMany: deleteMany('contactTag') },
    caseTag: { deleteMany: deleteMany('caseTag') },
    conversationTag: { deleteMany: deleteMany('conversationTag') },
  };

  await assert.rejects(() => deleteTagFlow(depsOf(log, tx), TENANT_ID, 'tag-1'), /db hiccup/);

  assert.deepEqual(log.entries, ['delete:contactTag', 'delete:caseTag', 'delete:conversationTag', 'rollback']);
});
