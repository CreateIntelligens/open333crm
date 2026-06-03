import type { PrismaClient, Conversation, Message } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { ChannelPlugin, ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { getChannelPlugin } from '@open333crm/channel-plugins';

export interface ProcessInboundMessageOptions {
  conversationId?: string;
  clientMessageId?: string;
  messageMetadata?: Record<string, unknown>;
}

export interface InboundChannelRef {
  id: string;
  channelType: string;
}

export interface InboundMessageContext {
  prisma: PrismaClient;
  io: SocketIOServer;
  credentials: Record<string, unknown>;
  channel: InboundChannelRef;
  tenantId: string;
  parsed: ParsedWebhookMessage;
  options: ProcessInboundMessageOptions;
  plugin: ChannelPlugin | undefined;
  now: Date;
  contactUid: string;
  contentType: string;
  content: Record<string, unknown>;
  channelMsgId: string | undefined;
  textContent: string;
  postbackData: string;
  channelSettings?: Record<string, unknown>;
  botConfig?: Record<string, unknown>;
  contactId?: string;
  channelIdentity?: {
    contactId: string;
    contact?: unknown;
  } | null;
  conversation?: Conversation;
  message?: Message;
}

export interface InboundMessageResult {
  conversation: Conversation;
  message: Message;
  duplicate: boolean;
}

export function createInboundMessageContext(
  prisma: PrismaClient,
  io: SocketIOServer,
  credentials: Record<string, unknown>,
  channel: InboundChannelRef,
  tenantId: string,
  parsed: ParsedWebhookMessage,
  options: ProcessInboundMessageOptions,
): InboundMessageContext | null {
  const { contactUid, contentType, content, channelMsgId } = parsed;
  if (!contactUid) return null;

  return {
    prisma,
    io,
    credentials,
    channel,
    tenantId,
    parsed,
    options,
    plugin: getChannelPlugin(channel.channelType),
    now: new Date(),
    contactUid,
    contentType,
    content,
    channelMsgId,
    textContent: (content as Record<string, unknown>).text as string || '',
    postbackData: (parsed as { rawPayload?: { postback?: { data?: string } } }).rawPayload?.postback?.data || '',
  };
}

export async function getChannelSettings(ctx: InboundMessageContext): Promise<Record<string, unknown>> {
  if (ctx.channelSettings) return ctx.channelSettings;

  const fullChannel = await ctx.prisma.channel.findFirst({
    where: { id: ctx.channel.id },
    select: { settings: true },
  });

  ctx.channelSettings = (fullChannel?.settings || {}) as Record<string, unknown>;
  return ctx.channelSettings;
}

export async function getBotConfig(ctx: InboundMessageContext): Promise<Record<string, unknown>> {
  if (ctx.botConfig) return ctx.botConfig;

  const channelSettings = await getChannelSettings(ctx);
  ctx.botConfig = (channelSettings.botConfig || {}) as Record<string, unknown>;
  return ctx.botConfig;
}
