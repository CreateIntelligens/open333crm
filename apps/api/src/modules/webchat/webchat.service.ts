import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { processInboundMessage } from '../webhook/webhook.service.js';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { AppError } from '../../shared/utils/response.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val);
}

export async function initVisitorSession(
  prisma: PrismaClient,
  channelId: string,
  visitorToken: string,
): Promise<{ visitorToken: string; greeting: string | null }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, channelType: 'WEBCHAT', isActive: true },
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
    where: { id: channelId, channelType: 'WEBCHAT', isActive: true },
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
