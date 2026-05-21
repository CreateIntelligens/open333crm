import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-chatbox-jwt-secret';
process.env.CHATBOX_SESSION_SECRET = 'test-chatbox-session-secret';

import { AppError } from '../shared/utils/response.js';
import {
  bootstrapChatboxSession,
  createChatboxSession,
  handleChatboxMessage,
  hashChatboxFingerprint,
  issueChatboxSessionId,
  normalizeChatboxFingerprint,
  verifyChatboxSession,
  verifyChatboxSessionId,
} from '../modules/chatbox/chatbox.service.js';
import {
  createChatboxMessageRegistry,
  registerBuiltInChatboxMessageHandlers,
} from '../modules/chatbox/chatbox.registry.js';
import { WebchatPlugin } from '@open333crm/channel-plugins';

type MockFn = ((...args: any[]) => any) & { calls: any[][] };

function mockFn(impl?: (...args: any[]) => any): MockFn {
  const fn = ((...args: any[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

async function expectAppError(run: () => Promise<unknown> | unknown, code: string, statusCode: number) {
  try {
    await run();
    assert.fail('Expected AppError');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, code);
    assert.equal(err.statusCode, statusCode);
  }
}

function createChannel() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    channelType: 'WEBCHAT',
    displayName: 'Support',
    publicKey: 'ch_public',
    isActive: true,
    credentialsEncrypted: '{}',
    settings: {
      welcomeMessage: 'Hello',
      chatboxTheme: {
        backgroundImageUrl: 'https://example.test/bg.png',
        backgroundSize: 'cover',
      },
    },
  };
}

function createSessionRecord(overrides: Record<string, unknown> = {}) {
  const fingerprint = normalizeChatboxFingerprint({
    browserFamily: 'chrome',
    osFamily: 'macos',
    language: 'zh-TW',
    timezone: 'Asia/Taipei',
    screenBucket: 'lg',
  });
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    channelId: 'channel-1',
    conversationId: 'conversation-1',
    visitorToken: '33333333-3333-4333-8333-333333333333',
    tokenDigest: 'digest',
    fingerprintHash: hashChatboxFingerprint(fingerprint),
    fingerprintVersion: 1,
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: null,
    revokedAt: null,
    riskLevel: 'LOW',
    metadata: { fingerprint },
    channel: createChannel(),
    ...overrides,
  };
}

function mockIo() {
  return {
    to: mockFn(() => ({ emit: mockFn() })),
  };
}

function testSessionIdIsSignedAndTamperResistant() {
  const issued = issueChatboxSessionId();

  assert.ok(issued.sessionId.startsWith('cb2.'));
  assert.ok(!issued.tokenDigest.includes(issued.sessionId));
  assert.equal(verifyChatboxSessionId(issued.sessionId).tokenDigest, issued.tokenDigest);
  assert.throws(() => verifyChatboxSessionId(`${issued.sessionId}x`), AppError);
}

function testSessionIdCarriesEncryptedExpiry() {
  const issued = issueChatboxSessionId(new Date(Date.now() - 1000));

  assert.ok(!issued.sessionId.includes('expiresAt'));
  assert.ok(!issued.sessionId.includes(String(Date.now()).slice(0, 6)));
  assert.throws(() => verifyChatboxSessionId(issued.sessionId), AppError);
}

async function testVerifyUpdatesLastSeenForMatchingFingerprint() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const update = mockFn((args) => ({ ...session, ...args.data }));
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update,
    },
  };

  const verified = await verifyChatboxSession(prisma as never, {
    sessionId: issued.sessionId,
    fingerprint: {
      browserFamily: 'chrome',
      osFamily: 'macos',
      language: 'zh-TW',
      timezone: 'Asia/Taipei',
      screenBucket: 'lg',
    },
  });

  assert.equal(verified.conversationId, 'conversation-1');
  assert.equal(update.calls[0][0].data.lastSeenAt instanceof Date, true);
}

async function testVerifyRejectsExpiredAndStrongMismatch() {
  const issued = issueChatboxSessionId();
  const expiredPrisma = {
    chatboxSession: {
      findUnique: mockFn(() => createSessionRecord({ tokenDigest: issued.tokenDigest, expiresAt: new Date(Date.now() - 1000) })),
    },
  };
  await expectAppError(
    () => verifyChatboxSession(expiredPrisma as never, { sessionId: issued.sessionId }),
    'UNAUTHORIZED',
    401,
  );

  const update = mockFn((args) => ({ ...createSessionRecord(), ...args.data }));
  const mismatchPrisma = {
    chatboxSession: {
      findUnique: mockFn(() => createSessionRecord({ tokenDigest: issued.tokenDigest })),
      update,
    },
  };
  await expectAppError(
    () => verifyChatboxSession(mismatchPrisma as never, {
      sessionId: issued.sessionId,
      fingerprint: {
        browserFamily: 'firefox',
        osFamily: 'windows',
        language: 'en-US',
        timezone: 'America/New_York',
        screenBucket: 'sm',
      },
    }),
    'FORBIDDEN',
    403,
  );
  assert.equal(update.calls[0][0].data.riskLevel, 'HIGH');
}

async function testBootstrapOmitsPersistedMessages() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };

  const result = await bootstrapChatboxSession(prisma as never, {
    sessionId: issued.sessionId,
    fingerprint: {
      browserFamily: 'chrome',
      osFamily: 'macos',
      language: 'zh-TW',
      timezone: 'Asia/Taipei',
      screenBucket: 'lg',
    },
  });
  assert.equal(result.config.greeting, 'Hello');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'messages'), false);
}

async function testCreateSessionCreatesContactConversationAndDigestOnlySession() {
  const channel = createChannel();
  const tx = {
    contact: { create: mockFn(() => ({ id: 'contact-1', displayName: 'Chatbox Visitor 333333' })) },
    channelIdentity: { create: mockFn(() => ({ id: 'identity-1' })) },
    conversation: { create: mockFn(() => ({ id: 'conversation-1', status: 'BOT_HANDLED' })) },
    chatboxSession: { create: mockFn(() => ({ id: 'session-1' })) },
  };
  const prisma = {
    channel: { findFirst: mockFn(() => channel) },
    $transaction: mockFn((fn) => fn(tx)),
  };

  const result = await createChatboxSession(prisma as never, mockIo() as never, {
    channelPublicKey: channel.publicKey,
    fingerprint: { browserFamily: 'chrome' },
  });

  assert.ok(result.redirectUrl.includes('/chatbox?channel=ch_public'));
  assert.equal(tx.conversation.create.calls.length, 1);
  const sessionData = tx.chatboxSession.create.calls[0][0].data;
  assert.equal(typeof sessionData.tokenDigest, 'string');
  assert.notEqual(sessionData.tokenDigest, result.sessionId);
  assert.equal(Object.prototype.hasOwnProperty.call(sessionData, 'sessionId'), false);
}

function testMessageRegistryValidatesBuiltIns() {
  const registry = createChatboxMessageRegistry();
  registerBuiltInChatboxMessageHandlers(registry);

  const parsed = registry.parse({
    sessionId: 'cb1.token.signature',
    clientMessageId: 'client-1',
    type: 'text',
    payload: { text: 'hello' },
  });
  assert.deepEqual(parsed, { contentType: 'text', content: { text: 'hello' } });

  assert.throws(
    () => registry.parse({
      sessionId: 'cb1.token.signature',
      clientMessageId: 'client-2',
      type: 'unknown' as never,
      payload: {},
    }),
    AppError,
  );
}

async function testClientMessageIdDuplicateReturnsOriginalAck() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const existingMessage = {
    id: 'message-1',
    direction: 'INBOUND',
    senderType: 'CONTACT',
    senderId: null,
    contentType: 'text',
    content: { text: 'hello' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    sequence: 1,
  };
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
    message: {
      findUnique: mockFn(() => existingMessage),
    },
  };
  const registry = createChatboxMessageRegistry();
  registerBuiltInChatboxMessageHandlers(registry);

  const result = await handleChatboxMessage(prisma as never, mockIo() as never, registry, {
    sessionId: issued.sessionId,
    clientMessageId: 'client-1',
    type: 'text',
    payload: { text: 'hello' },
    fingerprint: {
      browserFamily: 'chrome',
      osFamily: 'macos',
      language: 'zh-TW',
      timezone: 'Asia/Taipei',
      screenBucket: 'lg',
    },
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.message.id, 'message-1');
}

async function testChatboxMediaUsesSessionVisitorToken() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };

  const verified = await verifyChatboxSession(prisma as never, {
    sessionId: issued.sessionId,
    fingerprint: {
      browserFamily: 'chrome',
      osFamily: 'macos',
      language: 'zh-TW',
      timezone: 'Asia/Taipei',
      screenBucket: 'lg',
    },
  });

  assert.equal(verified.visitorToken, session.visitorToken);
  assert.equal(verified.channelId, session.channelId);
}

async function testWebchatPluginContractRemainsUnchanged() {
  const plugin = new WebchatPlugin();
  const parsed = await plugin.parseWebhook(Buffer.from(JSON.stringify({
    messageId: 'webchat-message-1',
    contactUid: 'visitor-1',
    contentType: 'text',
    content: { text: 'hello' },
  })), {});
  const sent = await plugin.sendMessage('visitor-1', { contentType: 'text', content: { text: 'reply' } }, {});

  assert.equal(parsed[0].contactUid, 'visitor-1');
  assert.equal(parsed[0].contentType, 'text');
  assert.equal(sent.success, true);
  assert.match(sent.channelMsgId || '', /^webchat-msg-/);
}

testSessionIdIsSignedAndTamperResistant();
testSessionIdCarriesEncryptedExpiry();
await testVerifyUpdatesLastSeenForMatchingFingerprint();
await testVerifyRejectsExpiredAndStrongMismatch();
await testBootstrapOmitsPersistedMessages();
await testCreateSessionCreatesContactConversationAndDigestOnlySession();
testMessageRegistryValidatesBuiltIns();
await testClientMessageIdDuplicateReturnsOriginalAck();
await testChatboxMediaUsesSessionVisitorToken();
await testWebchatPluginContractRemainsUnchanged();

console.log('chatbox.service tests passed');
process.exit(0);
