/**
 * 公開 WebChat 的大小與有效期限限制（主規格 webchat-public-abuse-controls），
 * 以及 webchat-widget 的「Visitor sends a text message」在進站處理端的部分。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-chatbox-jwt-secret';
process.env.CHATBOX_SESSION_SECRET = process.env.CHATBOX_SESSION_SECRET || 'test-chatbox-session-secret';

const processInboundMessage = vi.hoisted(() => vi.fn());
vi.mock('#src/modules/webhook/webhook.service.js', () => ({ processInboundMessage }));
const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('#src/modules/storage/storage.service.js', () => ({ uploadFile }));

import { registerChannelPlugin, webchatPlugin } from '@open333crm/channel-plugins';
import { parseEnvConfig } from '#src/config/env.js';
import { AppError } from '#src/shared/utils/response.js';
import {
  claimChatboxSession,
  getChatboxSessionTtlMs,
  handleChatboxMessage,
  hashChatboxFingerprint,
  issueChatboxSessionId,
  normalizeChatboxFingerprint,
  type ChatboxClaimRedis,
} from '#src/modules/chatbox/chatbox.service.js';
import {
  createChatboxMessageRegistry,
  registerBuiltInChatboxMessageHandlers,
} from '#src/modules/chatbox/chatbox.registry.js';
import { uploadVisitorMedia } from '#src/modules/webchat/webchat.service.js';

registerChannelPlugin(webchatPlugin);

const FINGERPRINT = {
  browserFamily: 'chrome',
  osFamily: 'macos',
  language: 'zh-TW',
  timezone: 'Asia/Taipei',
  screenBucket: 'lg',
};

const originalTtl = process.env.CHATBOX_SESSION_TTL_MINUTES;

beforeEach(() => {
  processInboundMessage.mockReset().mockResolvedValue({
    duplicate: false,
    message: {
      id: 'message-1',
      direction: 'INBOUND',
      senderType: 'CONTACT',
      senderId: null,
      contentType: 'text',
      content: { text: 'hello' },
      createdAt: new Date('2026-10-07T00:00:00Z'),
      sequence: 1,
    },
  });
  uploadFile.mockReset().mockResolvedValue({ url: 'https://cdn.test/file' });
});

afterEach(() => {
  if (originalTtl === undefined) delete process.env.CHATBOX_SESSION_TTL_MINUTES;
  else process.env.CHATBOX_SESSION_TTL_MINUTES = originalTtl;
});

/** 已建立並 claim 的工作階段，以及 handleChatboxMessage 需要的 prisma 與 Redis */
async function claimedSession() {
  const issued = issueChatboxSessionId();
  const fingerprint = normalizeChatboxFingerprint(FINGERPRINT);
  const record = {
    id: 'session-1',
    tenantId: 'tenant-of-session',
    channelId: 'channel-of-session',
    conversationId: 'conversation-of-session',
    visitorToken: '33333333-3333-4333-8333-333333333333',
    tokenDigest: issued.tokenDigest,
    fingerprintHash: hashChatboxFingerprint(fingerprint),
    fingerprintVersion: 1,
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: null,
    revokedAt: null,
    riskLevel: 'LOW',
    metadata: { fingerprint },
    channel: {
      id: 'channel-of-session',
      tenantId: 'tenant-of-session',
      channelType: 'WEBCHAT',
      displayName: 'Support',
      isActive: true,
      settings: {},
    },
  };
  const store = new Map<string, string>();
  const redis: ChatboxClaimRedis = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
  };
  const prisma = {
    chatboxSession: {
      findUnique: async () => record,
      update: async (args: { data: Record<string, unknown> }) => ({ ...record, ...args.data }),
    },
    message: { findUnique: async () => null },
  };
  const { claimToken } = await claimChatboxSession(prisma as never, { sessionId: issued.sessionId, fingerprint: FINGERPRINT }, redis);
  return { sessionId: issued.sessionId, claimToken, prisma, redis };
}

function registry() {
  const value = createChatboxMessageRegistry();
  registerBuiltInChatboxMessageHandlers(value);
  return value;
}

async function expectAppError(run: () => Promise<unknown>, statusCode: number) {
  await assert.rejects(run, (err: unknown) => err instanceof AppError && err.statusCode === statusCode);
}

test('文字訊息超過 4000 個字元：回 400，不交給進站處理', async () => {
  const { sessionId, claimToken, prisma, redis } = await claimedSession();
  const send = (text: string) => handleChatboxMessage(prisma as never, {} as never, registry(), {
    sessionId,
    claimToken,
    clientMessageId: `client-${text.length}`,
    type: 'text',
    payload: { text },
    fingerprint: FINGERPRINT,
  }, redis);

  await expectAppError(() => send('x'.repeat(4001)), 400);
  assert.equal(processInboundMessage.mock.calls.length, 0);

  await send('x'.repeat(4000));
  assert.equal(processInboundMessage.mock.calls.length, 1, '4000 個字元要能送出');
});

test('Visitor sends a text message：以驗證過的工作階段的租戶與對話交給進站處理，不採用請求帶來的識別碼', async () => {
  const { sessionId, claimToken, prisma, redis } = await claimedSession();

  await handleChatboxMessage(prisma as never, {} as never, registry(), {
    sessionId,
    claimToken,
    clientMessageId: 'client-1',
    type: 'text',
    payload: { text: 'hello' },
    fingerprint: FINGERPRINT,
    tenantId: 'tenant-from-request',
    conversationId: 'conversation-from-request',
  } as never, redis);

  assert.equal(processInboundMessage.mock.calls.length, 1);
  const [, , , channel, tenantId, parsed, options] = processInboundMessage.mock.calls[0]!;
  assert.equal(channel.id, 'channel-of-session');
  assert.equal(tenantId, 'tenant-of-session');
  assert.equal(options.conversationId, 'conversation-of-session');
  assert.equal(parsed.contactUid, '33333333-3333-4333-8333-333333333333');
});

test('上傳的檔案類型不支援：回 400，不儲存檔案', async () => {
  const prisma = { channel: { findFirst: async () => ({ id: 'channel-1', tenantId: 'tenant-1' }) } };

  await expectAppError(
    () => uploadVisitorMedia(prisma as never, 'channel-1', 'visitor', Buffer.from('pdf'), 'file.pdf', 'application/pdf'),
    400,
  );
  assert.equal(uploadFile.mock.calls.length, 0);
});

test('上傳的檔案超過大小上限：圖片超過 20 MB、影片超過 25 MB 時回 400，不儲存檔案', async () => {
  const prisma = { channel: { findFirst: async () => ({ id: 'channel-1', tenantId: 'tenant-1' }) } };
  const MB = 1024 * 1024;

  await expectAppError(
    () => uploadVisitorMedia(prisma as never, 'channel-1', 'visitor', Buffer.alloc(20 * MB + 1), 'a.png', 'image/png'),
    400,
  );
  await expectAppError(
    () => uploadVisitorMedia(prisma as never, 'channel-1', 'visitor', Buffer.alloc(25 * MB + 1), 'a.mp4', 'video/mp4'),
    400,
  );
  assert.equal(uploadFile.mock.calls.length, 0);

  const image = await uploadVisitorMedia(prisma as never, 'channel-1', 'visitor', Buffer.alloc(20 * MB), 'a.png', 'image/png');
  const video = await uploadVisitorMedia(prisma as never, 'channel-1', 'visitor', Buffer.alloc(25 * MB), 'a.mp4', 'video/mp4');
  assert.deepEqual([image.contentType, video.contentType], ['image', 'video']);
  assert.equal(uploadFile.mock.calls.length, 2, '上限以內要能儲存');
  assert.equal(uploadFile.mock.calls[0]![3], 'tenant-1', '檔案存在渠道的租戶底下');
});

test('設定的有效期限超過三天：環境變數驗證失敗並指出 CHATBOX_SESSION_TTL_MINUTES', () => {
  const env = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret-12345',
    CREDENTIAL_ENCRYPTION_KEY: 'test-credential-encryption-key-32-bytes!!',
  };

  assert.equal(parseEnvConfig({ ...env, CHATBOX_SESSION_TTL_MINUTES: '4320' }).CHATBOX_SESSION_TTL_MINUTES, 4320);
  assert.throws(() => parseEnvConfig({ ...env, CHATBOX_SESSION_TTL_MINUTES: '4321' }), /CHATBOX_SESSION_TTL_MINUTES/);
});

test('建立工作階段時的有效期限：設定四天時以三天計算', () => {
  process.env.CHATBOX_SESSION_TTL_MINUTES = String(4 * 24 * 60);
  assert.equal(getChatboxSessionTtlMs(), 3 * 24 * 60 * 60 * 1000);

  process.env.CHATBOX_SESSION_TTL_MINUTES = '30';
  assert.equal(getChatboxSessionTtlMs(), 30 * 60 * 1000, '三天以內照設定');
});
