import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createCaseFromConversation,
  deleteCase,
  linkConversationToCase,
  transitionCase,
  updateCase,
} from '#src/modules/case/case.service.js';
import { AppError } from '#src/shared/utils/response.js';
import { createMockTenantCtx, MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';

/**
 * service 收 TenantCtx，只寫資料、回傳結果；推播與事件由 flow 送出，見 case.flow.test.ts（#337 階段 3）。
 */
const TENANT_ID = MOCK_TENANT_ID;
const ctxOf = (tx: unknown) => createMockTenantCtx(tx, TENANT_ID).ctx;

type MockFn = ((...args: unknown[]) => unknown) & { calls: unknown[][] };

function mockFn(impl?: (...args: unknown[]) => unknown): MockFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

function createBaseCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    tenantId: TENANT_ID,
    contactId: 'contact-1',
    channelId: 'channel-1',
    title: 'Broken appliance',
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    category: null,
    assigneeId: null,
    teamId: null,
    slaPolicy: null,
    slaDueAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    csatScore: null,
    csatComment: null,
    csatRespondedAt: null,
    csatSentAt: null,
    mergedIntoId: null,
    parentCaseId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
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

async function testDeleteCase() {
  const updateMany = mockFn();
  const remove = mockFn();
  const prisma = {
    case: {
      findFirst: mockFn(() => createBaseCase()),
      delete: remove,
    },
    conversation: { updateMany },
  };

  const result = await deleteCase(ctxOf(prisma), 'case-1');

  assert.equal(result.id, 'case-1');
  assert.deepEqual(updateMany.calls[0][0], {
    where: { tenantId: TENANT_ID, caseId: 'case-1' },
    data: { caseId: null },
  });
  assert.deepEqual(remove.calls[0][0], { where: { id: 'case-1' } });
}

async function testDeleteCaseRejectsCrossTenant() {
  const remove = mockFn();
  const prisma = {
    case: { findFirst: mockFn(() => null), delete: remove },
  };

  await expectAppError(
    () => deleteCase(ctxOf(prisma), 'case-2'),
    'NOT_FOUND',
    404,
  );
  assert.equal(remove.calls.length, 0);
}

async function testInvalidStatusPatch() {
  const update = mockFn();
  const prisma = {
    case: {
      findFirst: mockFn(() => createBaseCase({ status: 'CLOSED' })),
      update,
    },
  };

  await expectAppError(
    () => updateCase(ctxOf(prisma), 'case-1', { status: 'IN_PROGRESS' }),
    'INVALID_TRANSITION',
    422,
  );
  assert.equal(update.calls.length, 0);
}

async function testReopenClosedCase() {
  const updated = createBaseCase({ status: 'OPEN' });
  const prisma = {
    case: {
      findFirst: mockFn(() => createBaseCase({ status: 'CLOSED' })),
      update: mockFn(() => updated),
    },
    caseEvent: {
      create: mockFn(),
    },
  };

  const result = await transitionCase(ctxOf(prisma), 'case-1', 'agent-1', 'OPEN');

  assert.equal(result.updated.status, 'OPEN');
  assert.equal(result.before.status, 'CLOSED');
  assert.equal(prisma.caseEvent.create.calls[0][0].data.eventType, 'status_changed');
}

async function testCreateCaseFromConversation() {
  const conversationUpdate = mockFn();
  const caseEventCreate = mockFn();
  const txCase = createBaseCase();
  const tx = {
    conversation: {
      findFirst: mockFn(() => ({
        id: 'conversation-1',
        tenantId: TENANT_ID,
        contactId: 'contact-1',
        channelId: 'channel-1',
        caseId: null,
        contact: {},
        channel: {},
      })),
      update: conversationUpdate,
    },
    slaPolicy: { findFirst: mockFn(() => null) },
    case: { create: mockFn(() => txCase) },
    caseEvent: { create: caseEventCreate },
  };

  const result = await createCaseFromConversation(ctxOf(tx), 'conversation-1', 'agent-1', { title: 'From conversation' });

  assert.equal(result.id, 'case-1');
  assert.deepEqual(conversationUpdate.calls[0][0], {
    where: { id: 'conversation-1' },
    data: { caseId: 'case-1' },
  });
  assert.equal(caseEventCreate.calls[0][0].data.eventType, 'created');
}

async function testCreateCaseFromConversationRejectsDuplicate() {
  const caseCreate = mockFn();
  const tx = {
    conversation: {
      findFirst: mockFn(() => ({
        id: 'conversation-1',
        tenantId: TENANT_ID,
        contactId: 'contact-1',
        channelId: 'channel-1',
        caseId: 'case-existing',
      })),
    },
    case: { create: caseCreate },
  };

  await expectAppError(
    () => createCaseFromConversation(ctxOf(tx), 'conversation-1', 'agent-1', { title: 'Duplicate' }),
    'CONFLICT',
    409,
  );
  assert.equal(caseCreate.calls.length, 0);
}

async function testLinkConversationToCase() {
  const conversationUpdate = mockFn(() => ({
    id: 'conversation-2',
    caseId: 'case-1',
    channelType: 'LINE',
    status: 'ACTIVE',
    lastMessageAt: null,
  }));
  const prisma = {
    case: { findFirst: mockFn(() => createBaseCase()) },
    conversation: {
      findFirst: mockFn(() => ({
        id: 'conversation-2',
        tenantId: TENANT_ID,
        caseId: null,
      })),
      update: conversationUpdate,
    },
    caseEvent: { create: mockFn() },
    // 掛上工單時會查該對話已有的客服回覆來補首次回應（AUDIT SLA-01）；這裡沒有回覆
    message: { findFirst: mockFn(() => null) },
  };

  const result = await linkConversationToCase(ctxOf(prisma), 'case-1', 'conversation-2', 'agent-1');

  assert.equal(result.caseId, 'case-1');
  assert.deepEqual(conversationUpdate.calls[0][0], {
    where: { id: 'conversation-2' },
    data: { caseId: 'case-1' },
    select: {
      id: true,
      caseId: true,
      channelType: true,
      status: true,
      lastMessageAt: true,
    },
  });
}

async function testLinkConversationRejectsCrossTenant() {
  // 兩者都回 null 模擬「跨租戶查不到」——應拋 404 而非誤連。
  const prisma = {
    case: { findFirst: mockFn(() => null) },
    conversation: { findFirst: mockFn(() => null) },
  };

  await expectAppError(
    () => linkConversationToCase(ctxOf(prisma), 'case-1', 'conversation-foreign', 'agent-1'),
    'NOT_FOUND',
    404,
  );
}

test('delete case', testDeleteCase);
test('delete case rejects cross tenant', testDeleteCaseRejectsCrossTenant);
test('invalid status patch', testInvalidStatusPatch);
test('reopen closed case', testReopenClosedCase);
test('create case from conversation', testCreateCaseFromConversation);
test('create case from conversation rejects duplicate', testCreateCaseFromConversationRejectsDuplicate);
test('link conversation to case', testLinkConversationToCase);
test('link conversation rejects cross tenant', testLinkConversationRejectsCrossTenant);
