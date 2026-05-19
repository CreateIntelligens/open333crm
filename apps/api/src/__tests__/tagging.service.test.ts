import assert from 'node:assert/strict';
import { AppError } from '../shared/utils/response.js';
import {
  addTagToTarget,
  createTenantTag,
  deleteTenantTag,
  removeTagFromTarget,
} from '../modules/tag/tagging.service.js';

type MockFn = ((...args: unknown[]) => unknown) & { calls: unknown[][] };

function mockFn(impl?: (...args: unknown[]) => unknown): MockFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

async function expectAppError(
  run: () => Promise<unknown>,
  code: string,
  statusCode: number,
) {
  try {
    await run();
    assert.fail('Expected AppError');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, code);
    assert.equal(err.statusCode, statusCode);
  }
}

function createTag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tag-1',
    tenantId: 'tenant-1',
    name: 'VIP',
    color: '#6366f1',
    type: 'MANUAL',
    scope: 'CONTACT',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

async function testCreateTagRejectsDuplicateWithinScope() {
  const create = mockFn();
  const prisma = {
    tag: {
      findFirst: mockFn(() => ({ id: 'existing-tag' })),
      create,
    },
  };

  await expectAppError(
    () => createTenantTag(prisma as never, {
      tenantId: 'tenant-1',
      name: 'VIP',
      color: '#6366f1',
      type: 'MANUAL',
      scope: 'CONTACT',
    }),
    'CONFLICT',
    409,
  );
  assert.equal(create.calls.length, 0);
}

async function testCreateTagUsesTenantAndScope() {
  const created = createTag({ scope: 'CASE' });
  const prisma = {
    tag: {
      findFirst: mockFn(() => null),
      create: mockFn(() => created),
    },
  };

  const result = await createTenantTag(prisma as never, {
    tenantId: 'tenant-1',
    name: 'Escalated',
    color: '#ef4444',
    type: 'MANUAL',
    scope: 'CASE',
    description: 'Case tag',
  });

  assert.equal(result.scope, 'CASE');
  assert.deepEqual(prisma.tag.create.calls[0][0], {
    data: {
      tenantId: 'tenant-1',
      name: 'Escalated',
      color: '#ef4444',
      type: 'MANUAL',
      scope: 'CASE',
      description: 'Case tag',
    },
  });
}

async function testAddTagsForAllTargets() {
  const contactUpsert = mockFn(() => ({ id: 'contact-tag-1', tag: createTag() }));
  const caseUpsert = mockFn(() => ({ id: 'case-tag-1', tag: createTag({ scope: 'CASE' }) }));
  const conversationUpsert = mockFn(() => ({ id: 'conversation-tag-1', tag: createTag({ scope: 'CONVERSATION' }) }));
  const prisma = {
    contact: { findFirst: mockFn(() => ({ id: 'contact-1' })) },
    case: { findFirst: mockFn(() => ({ id: 'case-1' })) },
    conversation: { findFirst: mockFn(() => ({ id: 'conversation-1' })) },
    tag: {
      findFirst: mockFn((args: { where: { id: string } }) => {
        if (args.where.id === 'contact-tag') return createTag({ id: 'contact-tag', scope: 'CONTACT' });
        if (args.where.id === 'case-tag') return createTag({ id: 'case-tag', scope: 'CASE' });
        return createTag({ id: 'conversation-tag', scope: 'CONVERSATION' });
      }),
    },
    contactTag: { upsert: contactUpsert },
    caseTag: { upsert: caseUpsert },
    conversationTag: { upsert: conversationUpsert },
  };

  await addTagToTarget(prisma as never, {
    tenantId: 'tenant-1',
    targetType: 'CONTACT',
    targetId: 'contact-1',
    tagId: 'contact-tag',
    agentId: 'agent-1',
  });
  await addTagToTarget(prisma as never, {
    tenantId: 'tenant-1',
    targetType: 'CASE',
    targetId: 'case-1',
    tagId: 'case-tag',
    agentId: 'agent-1',
  });
  await addTagToTarget(prisma as never, {
    tenantId: 'tenant-1',
    targetType: 'CONVERSATION',
    targetId: 'conversation-1',
    tagId: 'conversation-tag',
    agentId: 'agent-1',
  });

  assert.equal(contactUpsert.calls.length, 1);
  assert.equal(caseUpsert.calls.length, 1);
  assert.equal(conversationUpsert.calls.length, 1);
  assert.deepEqual(caseUpsert.calls[0][0].update, {});
}

async function testRejectScopeMismatch() {
  const caseUpsert = mockFn();
  const prisma = {
    case: { findFirst: mockFn(() => ({ id: 'case-1' })) },
    tag: { findFirst: mockFn(() => createTag({ scope: 'CONTACT' })) },
    caseTag: { upsert: caseUpsert },
  };

  await expectAppError(
    () => addTagToTarget(prisma as never, {
      tenantId: 'tenant-1',
      targetType: 'CASE',
      targetId: 'case-1',
      tagId: 'tag-1',
      agentId: 'agent-1',
    }),
    'TAG_SCOPE_MISMATCH',
    400,
  );
  assert.equal(caseUpsert.calls.length, 0);
}

async function testRejectCrossTenantTag() {
  const upsert = mockFn();
  const prisma = {
    conversation: { findFirst: mockFn(() => ({ id: 'conversation-1' })) },
    tag: { findFirst: mockFn(() => null) },
    conversationTag: { upsert },
  };

  await expectAppError(
    () => addTagToTarget(prisma as never, {
      tenantId: 'tenant-1',
      targetType: 'CONVERSATION',
      targetId: 'conversation-1',
      tagId: 'foreign-tag',
      agentId: 'agent-1',
    }),
    'NOT_FOUND',
    404,
  );
  assert.equal(upsert.calls.length, 0);
}

async function testRemoveCaseTagOnlyDeletesAssignment() {
  const remove = mockFn();
  const prisma = {
    case: { findFirst: mockFn(() => ({ id: 'case-1' })) },
    tag: { findFirst: mockFn(() => createTag({ scope: 'CASE' })) },
    caseTag: {
      findUnique: mockFn(() => ({ id: 'case-tag-1' })),
      delete: remove,
    },
  };

  const result = await removeTagFromTarget(prisma as never, {
    tenantId: 'tenant-1',
    targetType: 'CASE',
    targetId: 'case-1',
    tagId: 'tag-1',
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(remove.calls[0][0], {
    where: { caseId_tagId: { caseId: 'case-1', tagId: 'tag-1' } },
  });
}

async function testDeleteTagRemovesAllAssignments() {
  const transaction = mockFn();
  const contactDeleteMany = mockFn(() => ({ table: 'contact_tags' }));
  const caseDeleteMany = mockFn(() => ({ table: 'case_tags' }));
  const conversationDeleteMany = mockFn(() => ({ table: 'conversation_tags' }));
  const tagDelete = mockFn(() => ({ table: 'tags' }));
  const prisma = {
    tag: {
      findFirst: mockFn(() => ({ id: 'tag-1' })),
      delete: tagDelete,
    },
    contactTag: { deleteMany: contactDeleteMany },
    caseTag: { deleteMany: caseDeleteMany },
    conversationTag: { deleteMany: conversationDeleteMany },
    $transaction: transaction,
  };

  const result = await deleteTenantTag(prisma as never, 'tenant-1', 'tag-1');

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(contactDeleteMany.calls[0][0], { where: { tagId: 'tag-1' } });
  assert.deepEqual(caseDeleteMany.calls[0][0], { where: { tagId: 'tag-1' } });
  assert.deepEqual(conversationDeleteMany.calls[0][0], { where: { tagId: 'tag-1' } });
  assert.deepEqual(tagDelete.calls[0][0], { where: { id: 'tag-1' } });
  assert.equal(transaction.calls[0][0].length, 4);
}

await testCreateTagRejectsDuplicateWithinScope();
await testCreateTagUsesTenantAndScope();
await testAddTagsForAllTargets();
await testRejectScopeMismatch();
await testRejectCrossTenantTag();
await testRemoveCaseTagOnlyDeletesAssignment();
await testDeleteTagRemovesAllAssignments();

console.log('tagging.service tests passed');
process.exit(0);
