import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { processInboundMessage } from '../webhook/webhook.service.js';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { AppError } from '../../shared/utils/response.js';
import { uploadFile } from '../storage/storage.service.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val);
}

export async function initVisitorSession(
  prisma: PrismaClient,
  channelId: string,
  visitorToken: string,
): Promise<{ visitorToken: string; greeting: string | null }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, channelType: CHANNEL_TYPE.WEBCHAT, isActive: true },
  });

  if (!channel) throw new AppError('Channel not found', 'NOT_FOUND', 404);

  const settings = (channel.settings ?? {}) as Record<string, unknown>;
  const greeting = (settings.welcomeMessage as string | undefined) ?? null;

  return { visitorToken, greeting };
}

export async function handleVisitorMessage(
  prisma: PrismaClient,
  io: SocketIOServer,
  channelId: string,
  visitorToken: string,
  contentType: string,
  content: Record<string, unknown>,
): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, channelType: CHANNEL_TYPE.WEBCHAT, isActive: true },
  });

  if (!channel) throw new AppError('Channel not found', 'NOT_FOUND', 404);

  const parsed: ParsedWebhookMessage = {
    channelMsgId: `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contactUid: visitorToken,
    timestamp: new Date(),
    contentType,
    content,
    rawPayload: { visitorToken, contentType, content },
  };

  await processInboundMessage(prisma, io, {}, channel, channel.tenantId, parsed);
}

export async function uploadVisitorMedia(
  prisma: PrismaClient,
  channelId: string,
  visitorToken: string,
  fileBuffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<{ url: string; contentType: 'image' | 'video' }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, channelType: CHANNEL_TYPE.WEBCHAT, isActive: true },
  });
  if (!channel) throw new AppError('Channel not found', 'NOT_FOUND', 404);

  const isImage = ALLOWED_IMAGE_MIMES.includes(mimetype);
  const isVideo = ALLOWED_VIDEO_MIMES.includes(mimetype);

  if (!isImage && !isVideo) {
    throw new AppError(
      `Unsupported file type. Allowed: ${[...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES].join(', ')}`,
      'BAD_REQUEST',
      400,
    );
  }

  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (fileBuffer.length > maxBytes) {
    throw new AppError(
      `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit`,
      'BAD_REQUEST',
      400,
    );
  }

  const uploaded = await uploadFile(fileBuffer, filename, mimetype, channel.tenantId, 'media', visitorToken);
  return { url: uploaded.url, contentType: isImage ? 'image' : 'video' };
}
