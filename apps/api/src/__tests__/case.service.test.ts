import assert from 'node:assert/strict';
import {
  createCaseFromConversation,
  deleteCase,
  linkConversationToCase,
  transitionCase,
  updateCase,
} from '../modules/case/case.service.js';
import { AppError } from '../shared/utils/response.js';

/**
 * RLS 上線後 withTenant() 會驗 tenantId 必須是合法 UUID
 * （lib/tenant-db.ts 的 UUID_RE），原本測試用的 'tenant-1' 會被擋下。
 */
const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

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
  const { io, events } = createIoMock();
  const updateMany = mockFn();
  const remove = mockFn();
  // deleteCase 已改為「不自開 $transaction」——原子性由外層 withTenant 交易保證
  // （避免巢狀交易）。因此 conversation / case 要掛在頂層而非交易回呼裡。
  const prisma = {
    case: {
      findFirst: mockFn(() => createBaseCase()),
      delete: remove,
    },
    conversation: { updateMany },
  };

  const result = await deleteCase(prisma as never, io as never, 'case-1', TENANT_ID);

  assert.deepEqual(result, { id: 'case-1' });
  assert.deepEqual(updateMany.calls[0][0], {
    where: { tenantId: TENANT_ID, caseId: 'case-1' },
    data: { caseId: null },
  });
  assert.deepEqual(remove.calls[0][0], { where: { id: 'case-1' } });
  assert.equal(events[0].room, `tenant:${TENANT_ID}`);
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
    () => deleteCase(prisma as never, io as never, 'case-2', TENANT_ID),
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
    () => updateCase(prisma as never, io as never, 'case-1', TENANT_ID, { status: 'IN_PROGRESS' }),
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
    TENANT_ID,
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
    // createCaseFromConversation 在交易外用 tenantScopedClient(prisma, tenantId)
    // 跑背景副作用（trackBroadcastCase / autoAssignCase）。那條路徑的錯誤會被
    // .catch() 吞掉，測試不驗它——但 $extends 必須存在，否則同步就炸。
    $extends: () => ({}),
    $transaction: mockFn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        // withTenant 會在交易內跑 set_config 設定 RLS 的 app.current_tenant，
        // 模擬的 tx 必須提供 $executeRaw，否則會炸在 tenant-db.ts
        $executeRaw: mockFn(async () => 1),
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
      }),
    ),
  };

  const result = await createCaseFromConversation(
    prisma as never,
    io as never,
    'conversation-1',
    TENANT_ID,
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
        // 同上：withTenant 需要 tx.$executeRaw 設定 RLS 的 app.current_tenant
        $executeRaw: mockFn(async () => 1),
        conversation: {
          findFirst: mockFn(() => ({
            id: 'conversation-1',
            tenantId: TENANT_ID,
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
      TENANT_ID,
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
  // linkConversationToCase 同樣已改為「不自開 $transaction」，
  // 原子性由外層 withTenant 保證——模型要掛頂層而非交易回呼裡。
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
  };

  const result = await linkConversationToCase(
    prisma as never,
    io as never,
    'case-1',
    'conversation-2',
    TENANT_ID,
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
  // 同上：不自開交易，模型掛頂層。
  // 兩者都回 null 模擬「跨租戶查不到」——應拋 404 而非誤連。
  const prisma = {
    case: { findFirst: mockFn(() => null) },
    conversation: { findFirst: mockFn(() => null) },
  };

  await expectAppError(
    () => linkConversationToCase(
      prisma as never,
      io as never,
      'case-1',
      'conversation-foreign',
      TENANT_ID,
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
