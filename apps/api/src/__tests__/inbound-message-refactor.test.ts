import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-inbound-refactor-jwt-secret';

import { eventBus, type AppEvent } from '../events/event-bus.js';
import { processInboundMessage } from '../modules/webhook/webhook.service.js';

type MockFn = ((...args: any[]) => any) & { calls: any[][] };

function mockFn(impl?: (...args: any[]) => any): MockFn {
  const fn = ((...args: any[]) => {
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

function createConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    channelId: 'channel-1',
    channelType: 'WEBCHAT',
    status: 'BOT_HANDLED',
    assignedToId: null,
    unreadCount: 0,
    lastMessageAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createInboundMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    direction: 'INBOUND',
    senderType: 'CONTACT',
    senderId: null,
    contentType: 'text',
    content: { text: 'hello' },
    metadata: {},
    channelMsgId: 'channel-msg-1',
    clientMessageId: null,
    sequence: 1,
    isRead: false,
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
    ...overrides,
  };
}

async function readSource(relativePath: string) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return readFile(resolve(here, relativePath), 'utf8');
}

async function captureEvents(run: () => Promise<unknown>) {
  const events: AppEvent[] = [];
  const handler = (event: AppEvent) => events.push(event);
  eventBus.subscribe('*', handler);
  try {
    await run();
  } finally {
    eventBus.unsubscribe('*', handler);
  }
  return events;
}

async function testMissingContactUidShortCircuits() {
  const { io, events } = createIoMock();
  const prisma = {
    channelIdentity: { findUnique: mockFn(() => assert.fail('channelIdentity should not be queried')) },
  };

  const result = await processInboundMessage(
    prisma as never,
    io as never,
    {},
    { id: 'channel-1', channelType: 'WEBCHAT' },
    'tenant-1',
    {
      contactUid: '',
      timestamp: new Date(),
      contentType: 'text',
      content: { text: 'ignored' },
    },
  );

  assert.equal(result, undefined);
  assert.equal(prisma.channelIdentity.findUnique.calls.length, 0);
  assert.equal(events.length, 0);
}

async function testDuplicateClientMessageReturnsExistingMessage() {
  const { io, events } = createIoMock();
  const conversation = createConversation();
  const existingMessage = createInboundMessage({ id: 'existing-message', clientMessageId: 'client-1' });
  const messageCreate = mockFn(() => assert.fail('duplicate path must not create message'));
  const conversationUpdate = mockFn(() => assert.fail('duplicate path must not update conversation'));
  const prisma = {
    channelIdentity: {
      findUnique: mockFn(() => ({ id: 'identity-1', contactId: 'contact-1', contact: { id: 'contact-1' } })),
    },
    conversation: {
      findFirst: mockFn(() => conversation),
      update: conversationUpdate,
    },
    message: {
      findUnique: mockFn(() => existingMessage),
      create: messageCreate,
    },
  };

  const result = await processInboundMessage(
    prisma as never,
    io as never,
    {},
    { id: 'channel-1', channelType: 'WEBCHAT' },
    'tenant-1',
    {
      contactUid: 'visitor-1',
      channelMsgId: 'channel-msg-1',
      timestamp: new Date(),
      contentType: 'text',
      content: { text: 'hello' },
    },
    { conversationId: 'conversation-1', clientMessageId: 'client-1' },
  );

  assert.equal(result?.duplicate, true);
  assert.equal(result?.message.id, 'existing-message');
  assert.deepEqual(prisma.conversation.findFirst.calls[0][0].where, {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    channelId: 'channel-1',
    status: { not: 'CLOSED' },
  });
  assert.equal(messageCreate.calls.length, 0);
  assert.equal(conversationUpdate.calls.length, 0);
  assert.equal(events.length, 0);
}

async function testCsatInterceptDoesNotPublishMessageReceived() {
  const { io } = createIoMock();
  const conversation = createConversation();
  const inboundMessage = createInboundMessage({ content: { text: 'csat:5:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  const prisma = {
    channelIdentity: {
      findUnique: mockFn(() => ({ id: 'identity-1', contactId: 'contact-1', contact: { id: 'contact-1' } })),
    },
    conversation: {
      findFirst: mockFn(() => conversation),
      update: mockFn(() => ({ ...conversation, unreadCount: 1, lastMessageAt: new Date() })),
    },
    message: {
      count: mockFn(() => 0),
      create: mockFn(() => inboundMessage),
    },
    case: {
      findUnique: mockFn(() => null),
    },
  };

  const events = await captureEvents(async () => {
    const result = await processInboundMessage(
      prisma as never,
      io as never,
      {},
      { id: 'channel-1', channelType: 'WEBCHAT' },
      'tenant-1',
      {
        contactUid: 'visitor-1',
        channelMsgId: 'channel-msg-1',
        timestamp: new Date(),
        contentType: 'text',
        content: { text: 'csat:5:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      },
    );
    assert.equal(result, undefined);
  });

  assert.equal(prisma.message.create.calls.length, 1);
  assert.equal(prisma.conversation.update.calls.length, 1);
  assert.equal(prisma.case.findUnique.calls.length, 1);
  assert.equal(events.some((event) => event.name === 'message.received'), false);
}

async function testFacadeAndCallerContractsFromSource() {
  const webhookSource = await readSource('../modules/webhook/webhook.service.ts');
  const webchatSource = await readSource('../modules/webchat/webchat.service.ts');
  const chatboxSource = await readSource('../modules/chatbox/chatbox.service.ts');

  assert.equal(webhookSource.includes('export async function processInboundMessage'), true);
  assert.equal(webhookSource.includes('options: ProcessInboundMessageOptions = {}'), true);
  assert.equal(webhookSource.includes('createInboundMessageContext(prisma, io, credentials, channel, tenantId, parsed, options)'), true);
  assert.equal(webhookSource.includes('await resolveInboundContact(ctx)'), true);
  assert.equal(webhookSource.includes('await resolveInboundConversation(ctx)'), true);
  assert.equal(webhookSource.includes('await runInboundPostbackInterceptors(ctx)'), true);
  assert.equal(webhookSource.includes('await triggerWebhookFlow(ctx)'), true);

  assert.equal(webhookSource.includes('await processInboundMessage(prisma, io, credentials, channel, tenantId, parsed)'), true);
  assert.equal(webchatSource.includes('await processInboundMessage(prisma, io, {}, channel, channel.tenantId, parsed)'), true);
  assert.equal(chatboxSource.includes('const result = await processInboundMessage('), true);
  assert.equal(chatboxSource.includes('conversationId: session.conversationId'), true);
  assert.equal(chatboxSource.includes('clientMessageId: input.clientMessageId'), true);
}

async function testRefactorStructureFromSource() {
  const files = [
    '../modules/webhook/inbound-message.types.ts',
    '../modules/webhook/inbound-contact-resolver.ts',
    '../modules/webhook/inbound-conversation-resolver.ts',
    '../modules/webhook/inbound-message-writer.ts',
    '../modules/webhook/inbound-postback-interceptors.ts',
    '../modules/webhook/inbound-socket-presenter.ts',
    '../modules/webhook/inbound-side-effects.ts',
  ];
  const sources = await Promise.all(files.map(readSource));
  const combined = sources.join('\n');

  assert.equal(combined.includes('new PrismaClient'), false);
  assert.equal(combined.includes('function buildMessageNewPayload'), true);
  assert.equal(combined.includes('function buildConversationUpdatedPayload'), true);
  assert.equal(combined.includes('getChannelSettings(ctx)'), true);
  assert.equal(combined.includes('getBotConfig(ctx)'), true);
  assert.equal(combined.includes('handleCsatResponse'), true);
  assert.equal(combined.includes('handleKbFeedback'), true);
  assert.equal(combined.includes('handleHandoffRequest'), true);
  assert.equal(combined.indexOf('handleCsatResponse') < combined.indexOf('handleKbFeedback'), true);
  assert.equal(combined.indexOf('handleKbFeedback') < combined.indexOf('handleHandoffRequest'), true);
}

await testMissingContactUidShortCircuits();
await testDuplicateClientMessageReturnsExistingMessage();
await testCsatInterceptDoesNotPublishMessageReceived();
await testFacadeAndCallerContractsFromSource();
await testRefactorStructureFromSource();

console.log('inbound-message-refactor tests passed');
process.exit(0);
