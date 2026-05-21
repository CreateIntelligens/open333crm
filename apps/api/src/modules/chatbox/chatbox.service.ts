import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  ChatboxBootstrapConfig,
  ChatboxFingerprintInput,
  ChatboxMessageInput,
  ChatboxMessageOutput,
  ChatboxSessionBootstrap,
} from '@open333crm/shared';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { eventBus } from '../../events/event-bus.js';
import { AppError } from '../../shared/utils/response.js';
import { processInboundMessage } from '../webhook/webhook.service.js';
import { uploadVisitorMedia } from '../webchat/webchat.service.js';
import type { ChatboxMessageRegistry } from './chatbox.registry.js';

const TOKEN_VERSION = 'cb2';
const FINGERPRINT_VERSION = 1;
const DEFAULT_SESSION_TTL_MINUTES = 24 * 60;
const STRONG_MISMATCH_THRESHOLD = 3;

interface NormalizedFingerprint {
  browserFamily: string;
  osFamily: string;
  language: string;
  timezone: string;
  screenBucket: string;
}

export interface VerifiedChatboxSession {
  id: string;
  tenantId: string;
  channelId: string;
  conversationId: string;
  visitorToken: string;
  expiresAt: Date;
  lastSeenAt: Date | null;
  fingerprintHash: string;
  channel: {
    id: string;
    tenantId: string;
    displayName: string;
    channelType: string;
    isActive: boolean;
    settings: unknown;
  };
}

export interface ChatboxSessionVerifier {
  verify(input: {
    sessionId: string;
    fingerprint?: ChatboxFingerprintInput;
    userAgent?: string;
  }): Promise<VerifiedChatboxSession>;
}

function getSessionSecret(): string {
  return process.env.CHATBOX_SESSION_SECRET || getConfig().JWT_SECRET;
}

function getSessionTtlMs(): number {
  const raw = Number(process.env.CHATBOX_SESSION_TTL_MINUTES ?? DEFAULT_SESSION_TTL_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_TTL_MINUTES;
  return minutes * 60 * 1000;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function digestTokenMaterial(randomPart: string): string {
  return createHash('sha256').update(`${randomPart}.${getSessionSecret()}`).digest('hex');
}

function getSessionEncryptionKey(): Buffer {
  return createHash('sha256').update(getSessionSecret()).digest();
}

function encryptSessionPayload(payload: { randomPart: string; expiresAt: number }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getSessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_VERSION}.${base64url(iv)}.${base64url(encrypted)}.${base64url(tag)}`;
}

function decryptSessionPayload(sessionId: string): { randomPart: string; expiresAt: number } {
  const [version, ivPart, encryptedPart, tagPart] = sessionId.split('.');
  if (version !== TOKEN_VERSION || !ivPart || !encryptedPart || !tagPart) {
    throw new AppError('Invalid chatbox session', 'UNAUTHORIZED', 401);
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', getSessionEncryptionKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ]);
    const payload = JSON.parse(decrypted.toString('utf8')) as { randomPart?: unknown; expiresAt?: unknown };
    if (typeof payload.randomPart !== 'string' || typeof payload.expiresAt !== 'number') {
      throw new Error('Invalid payload');
    }
    return { randomPart: payload.randomPart, expiresAt: payload.expiresAt };
  } catch {
    throw new AppError('Invalid chatbox session', 'UNAUTHORIZED', 401);
  }
}

export function issueChatboxSessionId(expiresAt = new Date(Date.now() + getSessionTtlMs())): { sessionId: string; tokenDigest: string } {
  const randomPart = base64url(randomBytes(32));
  return {
    sessionId: encryptSessionPayload({ randomPart, expiresAt: expiresAt.getTime() }),
    tokenDigest: digestTokenMaterial(randomPart),
  };
}

export function verifyChatboxSessionId(sessionId: string): { tokenDigest: string } {
  const payload = decryptSessionPayload(sessionId);
  if (payload.expiresAt <= Date.now()) {
    throw new AppError('Chatbox session is expired', 'UNAUTHORIZED', 401);
  }

  return { tokenDigest: digestTokenMaterial(payload.randomPart) };
}

function detectBrowserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('firefox/') || ua.includes('fxios/')) return 'firefox';
  if (ua.includes('safari/') || ua.includes('version/')) return 'safari';
  return 'unknown';
}

function detectOsFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

export function normalizeChatboxFingerprint(
  input: ChatboxFingerprintInput | undefined,
  userAgent = '',
): NormalizedFingerprint {
  return {
    browserFamily: (input?.browserFamily || detectBrowserFamily(userAgent)).toLowerCase(),
    osFamily: (input?.osFamily || detectOsFamily(userAgent)).toLowerCase(),
    language: (input?.language || 'unknown').toLowerCase().split(',')[0],
    timezone: (input?.timezone || 'unknown').toLowerCase(),
    screenBucket: (input?.screenBucket || 'unknown').toLowerCase(),
  };
}

function stableStringify(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = value[key];
    return acc;
  }, {}));
}

export function hashChatboxFingerprint(fingerprint: NormalizedFingerprint): string {
  return createHmac('sha256', getSessionSecret()).update(stableStringify(fingerprint as unknown as Record<string, unknown>)).digest('hex');
}

function countFingerprintMismatches(expected: NormalizedFingerprint, actual: NormalizedFingerprint): number {
  return (Object.keys(expected) as Array<keyof NormalizedFingerprint>).reduce((count, key) => (
    expected[key] !== actual[key] ? count + 1 : count
  ), 0);
}

function getInitialConversationStatus(channelSettings: Record<string, unknown>): 'BOT_HANDLED' | 'AGENT_HANDLED' {
  const botConfig = (channelSettings.botConfig || {}) as Record<string, unknown>;
  return botConfig.botMode === 'off' ? 'AGENT_HANDLED' : 'BOT_HANDLED';
}

function getSettings(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
}

function buildPublicConfig(channel: VerifiedChatboxSession['channel']): ChatboxBootstrapConfig {
  const settings = getSettings(channel.settings);
  const theme = getSettings(settings.chatboxTheme);
  const backgroundImageUrl = typeof theme.backgroundImageUrl === 'string' ? theme.backgroundImageUrl : null;

  return {
    channelId: channel.id,
    displayName: channel.displayName,
    greeting: typeof settings.welcomeMessage === 'string' ? settings.welcomeMessage : null,
    theme: {
      backgroundImageUrl,
      backgroundSize: theme.backgroundSize === 'contain' ? 'contain' : 'cover',
      backgroundPosition: typeof theme.backgroundPosition === 'string' ? theme.backgroundPosition : 'center',
      foregroundColor: typeof theme.foregroundColor === 'string' ? theme.foregroundColor : undefined,
      accentColor: typeof theme.accentColor === 'string' ? theme.accentColor : undefined,
    },
  };
}

export async function resolveChatboxChannel(prisma: PrismaClient, publicKey: string) {
  if (!publicKey) {
    throw new AppError('channel publicKey is required', 'BAD_REQUEST', 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { publicKey, channelType: CHANNEL_TYPE.WEBCHAT, isActive: true },
  });
  if (!channel) throw new AppError('Channel not found', 'NOT_FOUND', 404);
  return channel;
}

export async function createChatboxSession(
  prisma: PrismaClient,
  io: SocketIOServer,
  input: { channelPublicKey: string; fingerprint?: ChatboxFingerprintInput; userAgent?: string },
): Promise<{ sessionId: string; redirectUrl: string; expiresAt: string; config: ChatboxBootstrapConfig }> {
  const channel = await resolveChatboxChannel(prisma, input.channelPublicKey);
  const settings = getSettings(channel.settings);
  const visitorToken = randomUUID();
  const expiresAt = new Date(Date.now() + getSessionTtlMs());
  const { sessionId, tokenDigest } = issueChatboxSessionId(expiresAt);
  const fingerprint = normalizeChatboxFingerprint(input.fingerprint, input.userAgent);
  const fingerprintHash = hashChatboxFingerprint(fingerprint);

  const result = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.create({
      data: {
        tenantId: channel.tenantId,
        displayName: `Chatbox Visitor ${visitorToken.slice(-6)}`,
        language: input.fingerprint?.language ?? 'zh-TW',
      },
    });

    await tx.channelIdentity.create({
      data: {
        contactId: contact.id,
        channelId: channel.id,
        channelType: CHANNEL_TYPE.WEBCHAT,
        uid: visitorToken,
        profileName: contact.displayName,
      },
    });

    const conversation = await tx.conversation.create({
      data: {
        tenantId: channel.tenantId,
        contactId: contact.id,
        channelId: channel.id,
        channelType: CHANNEL_TYPE.WEBCHAT,
        status: getInitialConversationStatus(settings),
        unreadCount: 0,
        metadata: {
          source: 'chatbox',
          chatboxSession: true,
        },
      },
    });

    const session = await tx.chatboxSession.create({
      data: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        conversationId: conversation.id,
        visitorToken,
        tokenDigest,
        fingerprintHash,
        fingerprintVersion: FINGERPRINT_VERSION,
        expiresAt,
        lastSeenAt: new Date(),
        metadata: {
          fingerprint,
        } as any,
      },
    });

    return { contact, conversation, session };
  });

  eventBus.publish({
    name: 'conversation.created',
    tenantId: channel.tenantId,
    timestamp: new Date(),
    payload: {
      conversationId: result.conversation.id,
      contactId: result.contact.id,
      channelId: channel.id,
      channelType: CHANNEL_TYPE.WEBCHAT,
      source: 'chatbox',
    },
  });

  io.to(`tenant:${channel.tenantId}`).emit('conversation.created', {
    id: result.conversation.id,
    status: result.conversation.status,
    assignedToId: null,
    unreadCount: 0,
    lastMessageAt: null,
    source: 'chatbox',
  });

  const params = new URLSearchParams({ channel: input.channelPublicKey, sessionId });
  return {
    sessionId,
    redirectUrl: `/chatbox?${params.toString()}`,
    expiresAt: expiresAt.toISOString(),
    config: buildPublicConfig({
      id: channel.id,
      tenantId: channel.tenantId,
      displayName: channel.displayName,
      channelType: channel.channelType,
      isActive: channel.isActive,
      settings: channel.settings,
    }),
  };
}

export async function verifyChatboxSession(
  prisma: PrismaClient,
  input: { sessionId: string; fingerprint?: ChatboxFingerprintInput; userAgent?: string },
): Promise<VerifiedChatboxSession> {
  const { tokenDigest } = verifyChatboxSessionId(input.sessionId);
  const now = new Date();
  const session = await prisma.chatboxSession.findUnique({
    where: { tokenDigest },
    include: {
      channel: true,
    },
  });

  if (!session) throw new AppError('Invalid chatbox session', 'UNAUTHORIZED', 401);
  if (session.revokedAt || session.riskLevel === 'REVOKED') {
    throw new AppError('Chatbox session is revoked', 'FORBIDDEN', 403);
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new AppError('Chatbox session is expired', 'UNAUTHORIZED', 401);
  }
  if (!session.channel.isActive || session.channel.channelType !== CHANNEL_TYPE.WEBCHAT) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  const actualFingerprint = normalizeChatboxFingerprint(input.fingerprint, input.userAgent);
  const actualHash = hashChatboxFingerprint(actualFingerprint);
  if (actualHash !== session.fingerprintHash) {
    const metadata = getSettings(session.metadata);
    const expectedFingerprint = getSettings(metadata.fingerprint) as Partial<NormalizedFingerprint>;
    const mismatchCount = countFingerprintMismatches(
      normalizeChatboxFingerprint(expectedFingerprint, ''),
      actualFingerprint,
    );

    if (mismatchCount >= STRONG_MISMATCH_THRESHOLD) {
      await prisma.chatboxSession.update({
        where: { id: session.id },
        data: { riskLevel: 'HIGH' },
      });
      throw new AppError('Chatbox session fingerprint mismatch', 'FORBIDDEN', 403);
    }
  }

  const updated = await prisma.chatboxSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
    include: { channel: true },
  });

  return {
    id: updated.id,
    tenantId: updated.tenantId,
    channelId: updated.channelId,
    conversationId: updated.conversationId,
    visitorToken: updated.visitorToken,
    expiresAt: updated.expiresAt,
    lastSeenAt: updated.lastSeenAt,
    fingerprintHash: updated.fingerprintHash,
    channel: {
      id: updated.channel.id,
      tenantId: updated.channel.tenantId,
      displayName: updated.channel.displayName,
      channelType: updated.channel.channelType,
      isActive: updated.channel.isActive,
      settings: updated.channel.settings,
    },
  };
}

export async function bootstrapChatboxSession(
  prisma: PrismaClient,
  input: { sessionId: string; fingerprint?: ChatboxFingerprintInput; userAgent?: string },
): Promise<ChatboxSessionBootstrap> {
  const session = await verifyChatboxSession(prisma, input);
  return {
    session: {
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
    },
    config: buildPublicConfig(session.channel),
  };
}

export async function adaptChatboxMessageToWebchatParsed(
  session: VerifiedChatboxSession,
  input: ChatboxMessageInput,
  parsedContent: { contentType: string; content: Record<string, unknown> },
): Promise<ParsedWebhookMessage> {
  const plugin = getChannelPlugin(CHANNEL_TYPE.WEBCHAT);
  if (!plugin) {
    throw new AppError('WEBCHAT channel plugin is not registered', 'INTERNAL_ERROR', 500);
  }

  const channelMsgId = `chatbox-${input.clientMessageId}`;
  const rawBody = Buffer.from(JSON.stringify({
    messageId: channelMsgId,
    contactUid: session.visitorToken,
    timestamp: input.sentAt ?? new Date().toISOString(),
    contentType: parsedContent.contentType,
    content: parsedContent.content,
  }));
  const parsed = await plugin.parseWebhook(rawBody, {});
  const message = parsed[0];
  if (!message) throw new AppError('Unable to parse chatbox message', 'BAD_REQUEST', 400);

  return {
    ...message,
    channelMsgId,
    rawPayload: {
      source: 'chatbox',
      sessionId: session.id,
      clientMessageId: input.clientMessageId,
      locale: input.locale,
      content: parsedContent.content,
    },
  };
}

export async function handleChatboxMessage(
  prisma: PrismaClient,
  io: SocketIOServer,
  registry: ChatboxMessageRegistry,
  input: ChatboxMessageInput & { fingerprint?: ChatboxFingerprintInput; userAgent?: string },
): Promise<{ message: ChatboxMessageOutput; duplicate: boolean }> {
  const session = await verifyChatboxSession(prisma, input);
  const existing = await prisma.message.findUnique({
    where: {
      conversationId_clientMessageId: {
        conversationId: session.conversationId,
        clientMessageId: input.clientMessageId,
      },
    },
  });
  if (existing) {
    return { message: registry.serialize(existing), duplicate: true };
  }

  const parsedContent = registry.parse(input);
  const parsed = await adaptChatboxMessageToWebchatParsed(session, input, parsedContent);
  const result = await processInboundMessage(
    prisma,
    io,
    {},
    { id: session.channelId, channelType: CHANNEL_TYPE.WEBCHAT },
    session.tenantId,
    parsed,
    {
      conversationId: session.conversationId,
      clientMessageId: input.clientMessageId,
      messageMetadata: {
        source: 'chatbox',
        sessionId: session.id,
        locale: input.locale,
      },
    },
  );

  if (!result?.message) {
    logger.warn('[Chatbox] processInboundMessage returned without message');
    throw new AppError('Unable to save message', 'INTERNAL_ERROR', 500);
  }

  return { message: registry.serialize(result.message), duplicate: result.duplicate };
}

export async function uploadChatboxMedia(
  prisma: PrismaClient,
  session: VerifiedChatboxSession,
  fileBuffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<{ url: string; contentType: 'image' | 'video' }> {
  return uploadVisitorMedia(prisma, session.channelId, session.visitorToken, fileBuffer, filename, mimetype);
}
