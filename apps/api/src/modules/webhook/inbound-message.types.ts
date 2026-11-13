import type { PrismaClient, Conversation, Message } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { ChannelPlugin, ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { getBotConfig as readBotConfig, type BotConfig } from '@open333crm/automation';

export interface ProcessInboundMessageOptions {
  conversationId?: string;
  clientMessageId?: string;
  messageMetadata?: Record<string, unknown>;
  /**
   * app_tenant 連線：顧客回覆留言私訊時，以 inTenant() 綁租戶關聯觸發紀錄（change add-comment-keyword-private-reply D18）。
   * 沒給時退回入站的連線。
   */
  tenantPrisma?: PrismaClient;
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
  botConfig?: BotConfig;
  contactId?: string;
  /**
   * 本次請求是否為「該渠道 uid 首次建立身分」。
   *
   * 由 resolveInboundContact 設定：只有成功建立 ChannelIdentity 的那一次請求為 true。
   * 併發或平台重複投遞時，另一請求會撞 @@unique([channelId, uid]) 的 P2002 而維持 false，
   * 因此首次進站招呼語在多實例部署下也只會送出一次。
   */
  isFirstContact?: boolean;
  /**
   * 加入好友事件（contentType 'follow'）是否為這個渠道身分第一次加入（design D28）。
   * 由 recordInboundFollow 設定；其他事件沒有值。
   */
  isFirstFollow?: boolean;
  /**
   * 聯絡人由留言自動私訊的收件建立（change add-comment-keyword-private-reply D17）：第一次進站不送招呼語，
   * contact.created 改在第一次進站時以 comment_authors.contactEventPublishedAt 認領後發一次。
   */
  fromCommentReply?: boolean;
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

/** 渠道的機器人設定；不合法的舊值逐欄改用預設值（bot-handoff-config「讀取機器人設定時不合法的值改用預設值」） */
export async function getBotConfig(ctx: InboundMessageContext): Promise<BotConfig> {
  if (ctx.botConfig) return ctx.botConfig;

  const channelSettings = await getChannelSettings(ctx);
  ctx.botConfig = readBotConfig(channelSettings);
  return ctx.botConfig;
}
