import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-chatbox-jwt-secret';
process.env.CHATBOX_SESSION_SECRET = 'test-chatbox-session-secret';

import { AppError } from '../shared/utils/response.js';
import {
  bootstrapChatboxSession,
  claimChatboxSession,
  createChatboxSession,
  getChatboxClaimKey,
  handleChatboxMessage,
  hashChatboxFingerprint,
  issueChatboxSessionId,
  normalizeChatboxFingerprint,
  verifyClaimedChatboxSession,
  verifyChatboxSession,
  verifyChatboxSessionId,
  type ChatboxClaimRedis,
} from '../modules/chatbox/chatbox.service.js';
import {
  createChatboxMessageRegistry,
  registerBuiltInChatboxMessageHandlers,
} from '../modules/chatbox/chatbox.registry.js';
import { WebchatPlugin } from '@open333crm/channel-plugins';
import chatboxRoutes from '../modules/chatbox/chatbox.routes.js';
import { registerVisitorNamespace } from '../modules/webchat/webchat.socket.js';

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
  const fingerprint = createMatchingFingerprint();
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

function createMatchingFingerprint() {
  return normalizeChatboxFingerprint({
    browserFamily: 'chrome',
    osFamily: 'macos',
    language: 'zh-TW',
    timezone: 'Asia/Taipei',
    screenBucket: 'lg',
  });
}

function mockIo() {
  return {
    to: mockFn(() => ({ emit: mockFn() })),
  };
}

function createMockRedis(): ChatboxClaimRedis & {
  store: Map<string, { value: string; ttlMs: number }>;
} {
  const store = new Map<string, { value: string; ttlMs: number }>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX') {
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      if (store.has(key)) return null;
      store.set(key, { value, ttlMs });
      return 'OK';
    },
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
  const redis = createMockRedis();
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
  }, redis);
  assert.equal(result.config.greeting, 'Hello');
  assert.ok(result.claimToken.length >= 32);
  assert.equal(result.config.theme.backgroundImageUrl, 'https://example.test/bg.png');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'messages'), false);
}

async function testClaimCreatesRedisEntryWithSessionTtlAndNoRawSessionId() {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const issued = issueChatboxSessionId(expiresAt);
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest, expiresAt });
  const redis = createMockRedis();
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };

  const result = await claimChatboxSession(prisma as never, {
    sessionId: issued.sessionId,
    fingerprint: {
      browserFamily: 'chrome',
      osFamily: 'macos',
      language: 'zh-TW',
      timezone: 'Asia/Taipei',
      screenBucket: 'lg',
    },
  }, redis);

  const key = getChatboxClaimKey(issued.tokenDigest);
  const stored = redis.store.get(key);
  assert.ok(result.claimToken.length >= 32);
  assert.ok(stored);
  assert.ok(stored.ttlMs > 29 * 60 * 1000);
  assert.ok(stored.ttlMs <= 30 * 60 * 1000);
  assert.equal(key.includes(issued.sessionId), false);
  assert.equal(stored.value.includes(issued.sessionId), false);
}

async function testDuplicateClaimIsRejected() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const redis = createMockRedis();
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };

  await claimChatboxSession(prisma as never, { sessionId: issued.sessionId, fingerprint: createMatchingFingerprint() }, redis);
  await expectAppError(
    () => claimChatboxSession(prisma as never, { sessionId: issued.sessionId, fingerprint: createMatchingFingerprint() }, redis),
    'FORBIDDEN',
    403,
  );
}

async function testClaimedVerificationRequiresMatchingClaimToken() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const redis = createMockRedis();
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };
  const claimed = await claimChatboxSession(prisma as never, {
    sessionId: issued.sessionId,
    fingerprint: createMatchingFingerprint(),
  }, redis);

  const verified = await verifyClaimedChatboxSession(prisma as never, {
    sessionId: issued.sessionId,
    claimToken: claimed.claimToken,
    fingerprint: createMatchingFingerprint(),
  }, redis);
  assert.equal(verified.id, session.id);
  await expectAppError(
    () => verifyClaimedChatboxSession(prisma as never, {
      sessionId: issued.sessionId,
      claimToken: 'wrong-token',
      fingerprint: createMatchingFingerprint(),
    }, redis),
    'FORBIDDEN',
    403,
  );
  await expectAppError(
    () => verifyClaimedChatboxSession(prisma as never, {
      sessionId: issued.sessionId,
      fingerprint: createMatchingFingerprint(),
    }, redis),
    'UNAUTHORIZED',
    401,
  );
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
    claimToken: 'claim-token',
    clientMessageId: 'client-1',
    type: 'text',
    payload: { text: 'hello' },
  });
  assert.deepEqual(parsed, { contentType: 'text', content: { text: 'hello' } });

  assert.throws(
    () => registry.parse({
      sessionId: 'cb1.token.signature',
      claimToken: 'claim-token',
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
  const redis = createMockRedis();
  const claimPrisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };
  const claimed = await claimChatboxSession(claimPrisma as never, {
    sessionId: issued.sessionId,
    fingerprint: createMatchingFingerprint(),
  }, redis);
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
    claimToken: claimed.claimToken,
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
  }, redis);

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

async function testMessageRouteRequiresClaimToken() {
  const app = Fastify();
  await app.register(chatboxRoutes, { prefix: '/chatbox' });

  const response = await app.inject({
    method: 'POST',
    url: '/chatbox/messages',
    payload: {
      sessionId: 'x'.repeat(32),
      clientMessageId: 'client-1',
      type: 'text',
      payload: { text: 'hello' },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /claimToken/);
  await app.close();
}

async function testSessionVerifyRouteClaimsAndRejectsDuplicate() {
  const issued = issueChatboxSessionId();
  const session = createSessionRecord({ tokenDigest: issued.tokenDigest });
  const redis = createMockRedis();
  const prisma = {
    chatboxSession: {
      findUnique: mockFn(() => session),
      update: mockFn((args) => ({ ...session, ...args.data })),
    },
  };
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('chatboxClaimRedis', redis);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: err.message });
  });
  await app.register(chatboxRoutes, { prefix: '/chatbox' });

  const first = await app.inject({
    method: 'POST',
    url: '/chatbox/sessions/verify',
    payload: {
      sessionId: issued.sessionId,
      fingerprint: createMatchingFingerprint(),
    },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(redis.store.size, 1);
  assert.equal(typeof first.json().data.claimToken, 'string');

  const second = await app.inject({
    method: 'POST',
    url: '/chatbox/sessions/verify',
    payload: {
      sessionId: issued.sessionId,
      fingerprint: createMatchingFingerprint(),
    },
  });
  assert.equal(second.statusCode, 403);
  assert.equal(second.json().code, 'FORBIDDEN');
  await app.close();
}

async function testMediaRouteRequiresClaimToken() {
  const app = Fastify();
  await app.register(multipart);
  await app.register(chatboxRoutes, { prefix: '/chatbox' });
  const boundary = '----open333crm-test-boundary';
  const payload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="sessionId"',
    '',
    'x'.repeat(32),
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="image.png"',
    'Content-Type: image/png',
    '',
    'png',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response = await app.inject({
    method: 'POST',
    url: '/chatbox/media',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /claimToken/);
  await app.close();
}

async function testVisitorSocketRequiresAndAcceptsClaimToken() {
  let middleware: ((socket: any, next: (err?: Error) => void) => void | Promise<void>) | undefined;
  const namespace = {
    use: mockFn((fn) => {
      middleware = fn;
      return namespace;
    }),
    on: mockFn(() => namespace),
  };
  const io = { of: mockFn(() => namespace) };
  const verifier = {
    verify: mockFn(() => Promise.resolve(createSessionRecord())),
  };

  registerVisitorNamespace(io as never, {} as never, verifier as never);
  assert.ok(middleware);

  const acceptedSocket = {
    handshake: {
      address: '127.0.0.10',
      auth: { sessionId: 'cb2.session', claimToken: 'claim-token', fingerprint: createMatchingFingerprint() },
      headers: { 'user-agent': 'Chrome' },
    },
    data: {},
  };
  const acceptedError = await new Promise<Error | undefined>((resolve) => {
    void middleware?.(acceptedSocket, resolve);
  });
  assert.equal(acceptedError, undefined);
  assert.equal(verifier.verify.calls[0][0].claimToken, 'claim-token');
  assert.equal(acceptedSocket.data.chatboxSessionId, 'session-1');

  verifier.verify = mockFn(() => Promise.reject(new Error('missing claim')));
  const rejectedSocket = {
    handshake: {
      address: '127.0.0.11',
      auth: { sessionId: 'cb2.session' },
      headers: {},
    },
    data: {},
  };
  const rejectedError = await new Promise<Error | undefined>((resolve) => {
    void middleware?.(rejectedSocket, resolve);
  });
  assert.equal(rejectedError?.message, 'Secure Chatbox session required');

  const legacySocket = {
    handshake: {
      address: '127.0.0.12',
      auth: {
        visitorToken: '33333333-3333-4333-8333-333333333333',
        channelId: '11111111-1111-4111-8111-111111111111',
      },
      headers: {},
    },
    data: {},
  };
  const legacyError = await new Promise<Error | undefined>((resolve) => {
    void middleware?.(legacySocket, resolve);
  });
  assert.equal(legacyError?.message, 'Secure Chatbox session required');
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
await testClaimCreatesRedisEntryWithSessionTtlAndNoRawSessionId();
await testDuplicateClaimIsRejected();
await testClaimedVerificationRequiresMatchingClaimToken();
await testCreateSessionCreatesContactConversationAndDigestOnlySession();
testMessageRegistryValidatesBuiltIns();
await testClientMessageIdDuplicateReturnsOriginalAck();
await testChatboxMediaUsesSessionVisitorToken();
await testMessageRouteRequiresClaimToken();
await testSessionVerifyRouteClaimsAndRejectsDuplicate();
await testMediaRouteRequiresClaimToken();
await testVisitorSocketRequiresAndAcceptsClaimToken();
await testWebchatPluginContractRemainsUnchanged();

console.log('chatbox.service tests passed');
process.exit(0);
