import assert from 'node:assert/strict';
import {
  createCaseFromConversation,
  deleteCase,
  linkConversationToCase,
  transitionCase,
  updateCase,
} from '../modules/case/case.service.js';
import { AppError } from '../shared/utils/response.js';

type MockFn = ((...args: unknown[]) => unknown) & { calls: unknown[][] };

function mockFn(impl?: (...args: unknown[]) => unknown): MockFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

function createIoMock() {
  const events: Array<{ room: string; event: string; payload: unknown }> = [];
  return {
    events,
    io: {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            events.push({ room, event, payload });
          },
        };
      },
    },
  };
}

function createBaseCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    tenantId: 'tenant-1',
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
  const { io, events } = createIoMock();
  const updateMany = mockFn();
  const remove = mockFn();
  const prisma = {
    case: {
      findFirst: mockFn(() => createBaseCase()),
    },
    $transaction: mockFn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        conversation: { updateMany },
        case: { delete: remove },
      }),
    ),
  };

  const result = await deleteCase(prisma as never, io as never, 'case-1', 'tenant-1');

  assert.deepEqual(result, { id: 'case-1' });
  assert.deepEqual(updateMany.calls[0][0], {
    where: { tenantId: 'tenant-1', caseId: 'case-1' },
    data: { caseId: null },
  });
  assert.deepEqual(remove.calls[0][0], { where: { id: 'case-1' } });
  assert.equal(events[0].room, 'tenant:tenant-1');
  assert.equal(events[0].event, 'case.deleted');
}

async function testDeleteCaseRejectsCrossTenant() {
  const { io } = createIoMock();
  const transaction = mockFn();
  const prisma = {
    case: { findFirst: mockFn(() => null) },
    $transaction: transaction,
  };

  await expectAppError(
    () => deleteCase(prisma as never, io as never, 'case-2', 'tenant-1'),
    'NOT_FOUND',
    404,
  );
  assert.equal(transaction.calls.length, 0);
}

async function testInvalidStatusPatch() {
  const { io } = createIoMock();
  const update = mockFn();
  const prisma = {
    case: {
      findFirst: mockFn(() => createBaseCase({ status: 'CLOSED' })),
      update,
    },
  };

  await expectAppError(
    () => updateCase(prisma as never, io as never, 'case-1', 'tenant-1', { status: 'IN_PROGRESS' }),
    'INVALID_TRANSITION',
    422,
  );
  assert.equal(update.calls.length, 0);
}

async function testReopenClosedCase() {
  const { io, events } = createIoMock();
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

  const result = await transitionCase(
    prisma as never,
    io as never,
    'case-1',
    'tenant-1',
    'agent-1',
    'OPEN',
  );

  assert.equal(result.status, 'OPEN');
  assert.equal(prisma.caseEvent.create.calls[0][0].data.eventType, 'status_changed');
  assert.equal(events[0].event, 'case.updated');
}

async function testCreateCaseFromConversation() {
  const { io, events } = createIoMock();
  const conversationUpdate = mockFn();
  const caseEventCreate = mockFn();
  const txCase = createBaseCase();
  const prisma = {
    $transaction: mockFn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        conversation: {
          findFirst: mockFn(() => ({
            id: 'conversation-1',
            tenantId: 'tenant-1',
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
      }),
    ),
  };

  const result = await createCaseFromConversation(
    prisma as never,
    io as never,
    'conversation-1',
    'tenant-1',
    'agent-1',
    { title: 'From conversation' },
  );

  assert.equal(result.id, 'case-1');
  assert.deepEqual(conversationUpdate.calls[0][0], {
    where: { id: 'conversation-1' },
    data: { caseId: 'case-1' },
  });
  assert.equal(caseEventCreate.calls[0][0].data.eventType, 'created');
  assert.equal(events[0].event, 'case.created');
}

async function testCreateCaseFromConversationRejectsDuplicate() {
  const { io } = createIoMock();
  const prisma = {
    $transaction: mockFn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        conversation: {
          findFirst: mockFn(() => ({
            id: 'conversation-1',
            tenantId: 'tenant-1',
            contactId: 'contact-1',
            channelId: 'channel-1',
            caseId: 'case-existing',
          })),
        },
      }),
    ),
  };

  await expectAppError(
    () => createCaseFromConversation(
      prisma as never,
      io as never,
      'conversation-1',
      'tenant-1',
      'agent-1',
      { title: 'Duplicate' },
    ),
    'CONFLICT',
    409,
  );
}

async function testLinkConversationToCase() {
  const { io, events } = createIoMock();
  const conversationUpdate = mockFn(() => ({
    id: 'conversation-2',
    caseId: 'case-1',
    channelType: 'LINE',
    status: 'ACTIVE',
    lastMessageAt: null,
  }));
  const prisma = {
    $transaction: mockFn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        case: { findFirst: mockFn(() => createBaseCase()) },
        conversation: {
          findFirst: mockFn(() => ({
            id: 'conversation-2',
            tenantId: 'tenant-1',
            caseId: null,
          })),
          update: conversationUpdate,
        },
        caseEvent: { create: mockFn() },
      }),
    ),
  };

  const result = await linkConversationToCase(
    prisma as never,
    io as never,
    'case-1',
    'conversation-2',
    'tenant-1',
    'agent-1',
  );

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
  assert.equal(events[0].event, 'case.updated');
}

async function testLinkConversationRejectsCrossTenant() {
  const { io } = createIoMock();
  const prisma = {
    $transaction: mockFn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        case: { findFirst: mockFn(() => null) },
        conversation: { findFirst: mockFn(() => null) },
      }),
    ),
  };

  await expectAppError(
    () => linkConversationToCase(
      prisma as never,
      io as never,
      'case-1',
      'conversation-foreign',
      'tenant-1',
      'agent-1',
    ),
    'NOT_FOUND',
    404,
  );
}

await testDeleteCase();
await testDeleteCaseRejectsCrossTenant();
await testInvalidStatusPatch();
await testReopenClosedCase();
await testCreateCaseFromConversation();
await testCreateCaseFromConversationRejectsDuplicate();
await testLinkConversationToCase();
await testLinkConversationRejectsCrossTenant();

console.log('case.service tests passed');
process.exit(0);
