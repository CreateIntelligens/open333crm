import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import {
  createInboundMessageContext,
  type ProcessInboundMessageOptions,
} from './inbound-message.types.js';
import { resolveInboundContact } from './inbound-contact-resolver.js';
import { resolveInboundConversation } from './inbound-conversation-resolver.js';
import {
  createInboundMessage,
  findDuplicateInboundMessage,
  updateConversationAfterInboundMessage,
} from './inbound-message-writer.js';
import { runInboundPostbackInterceptors } from './inbound-postback-interceptors.js';
import {
  emitInboundSocketEvents,
  publishMessageReceived,
  resolveInboundMediaAsync,
  sendOutsideHoursAutoReply,
  trackInboundBroadcastReply,
  triggerWebhookFlow,
} from './inbound-side-effects.js';
import { forwardToDownstream, getDownstreamWebhookConfig } from './downstream-forwarder.js';
import { claimForForward } from './downstream-loop-guard.js';

export async function processWebhookEvent(
  prisma: PrismaClient,
  io: SocketIOServer,
  channelId: string,
  channelType: string,
  rawBody: Buffer,
  headers: Record<string, string>,
) {
  logger.info('[Webhook] Received', { channelId, channelType, bodyBytes: rawBody?.length ?? 0 });

  // 1. Load channel from DB（一併載入所屬租戶的啟用狀態）
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, isActive: true },
    include: { tenant: { select: { isActive: true } } },
  });

  if (!channel) {
    logger.warn('[Webhook] Channel not found or inactive', { channelId });
    throw new Error(`Channel not found or inactive: ${channelId}`);
  }

  // 租戶被停用（例如欠費停權）時，即使 channel 本身 active 也不處理其 inbound 訊息。
  // 這是預期內情況（非錯誤）：route 早已回 200，此處安靜 return 丟棄即可，
  // 用 throw 會冒 error 級堆疊噪音、看起來像故障。用 optional chaining 防孤兒列。
  if (!channel.tenant?.isActive) {
    logger.warn('[Webhook] Tenant is disabled, dropping event', { channelId, tenantId: channel.tenantId });
    return;
  }
  logger.info('[Webhook] Channel found', { channelId, channelType: channel.channelType, tenantId: channel.tenantId });

  const tenantId = channel.tenantId;

  // 2. Get plugin and decrypt credentials
  const plugin = getChannelPlugin(channelType);
  if (!plugin) {
    logger.warn('[Webhook] No plugin registered for channel type', { channelType });
    throw new Error(`No plugin for channel type: ${channelType}`);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  // 簽章驗證用的 secret：FB 與 IG(THREADS) 用 App Secret（X-Hub-Signature-256），
  // LINE 等其餘用 channelSecret。THREADS 若誤用 channelSecret 會永遠驗簽失敗。
  const secret = (channelType === CHANNEL_TYPE.FB || channelType === CHANNEL_TYPE.THREADS
    ? credentials.appSecret
    : credentials.channelSecret) as string;

  logger.info('[Webhook] Verifying signature', { channelId, channelType, hasSecret: !!secret });

  // 3. Verify signature
  if (!plugin.verifySignature(rawBody, headers, secret)) {
    logger.warn('[Webhook] Signature verification failed', { channelId, channelType });
    throw new Error('Invalid webhook signature');
  }
  logger.info('[Webhook] Signature OK', { channelId, channelType });

  // 3b. Downstream webhook forwarding (any channel). See openspec `line-downstream-webhook`.
  const downstream = getDownstreamWebhookConfig(channel.settings);
  if (downstream && downstream.mode === 'immediate') {
    // Immediate mode: forward the original payload, then short-circuit —
    // skip parse + CRM inbound processing (downstream takes over).
    // Loop guard: if the downstream shot our own forward back, drop it.
    if (await claimForForward(channelId, rawBody)) {
      logger.info('[Webhook] Downstream immediate — forwarding and short-circuiting', { channelId });
      void forwardToDownstream(downstream, rawBody, headers, channel);
    } else {
      logger.warn('[Webhook] Downstream loopback detected — dropping (immediate)', { channelId });
    }
    return;
  }

  // 4. Parse webhook into normalized messages
  const parsedMessages = await plugin.parseWebhook(rawBody, headers);

  logger.info('[Webhook] Parsed', {
    channelId,
    channelType,
    count: parsedMessages.length,
    messages: parsedMessages.map(m => ({ contactUid: m.contactUid, contentType: m.contentType, channelMsgId: m.channelMsgId })),
  });

  if (parsedMessages.length === 0) {
    logger.info('[Webhook] No actionable messages in payload', { channelId, channelType });
  }

  // 5. Process each message (same pattern as simulator.service.ts)
  for (const parsed of parsedMessages) {
    await processInboundMessage(prisma, io, credentials, channel, tenantId, parsed);
  }

  // 6. Downstream "after" mode: CRM processing done, now forward a copy.
  //    Loop guard: skip forwarding a payload the downstream shot back at us.
  if (downstream && downstream.mode === 'after') {
    if (await claimForForward(channelId, rawBody)) {
      void forwardToDownstream(downstream, rawBody, headers, channel);
    } else {
      logger.warn('[Webhook] Downstream loopback detected — skip forward (after)', { channelId });
    }
  }
}

export async function processInboundMessage(
  prisma: PrismaClient,
  io: SocketIOServer,
  credentials: Record<string, unknown>,
  channel: { id: string; channelType: string },
  tenantId: string,
  parsed: ParsedWebhookMessage,
  options: ProcessInboundMessageOptions = {},
) {
  const ctx = createInboundMessageContext(prisma, io, credentials, channel, tenantId, parsed, options);
  if (!ctx) return;

  await resolveInboundContact(ctx);
  await resolveInboundConversation(ctx);

  const duplicate = await findDuplicateInboundMessage(ctx);
  if (duplicate) return duplicate;

  await createInboundMessage(ctx);

  if (!ctx.conversation || !ctx.message) {
    throw new Error('Inbound message processing did not resolve conversation and message');
  }

  logger.info('[Webhook] Message saved', {
    messageId: ctx.message.id,
    conversationId: ctx.conversation.id,
    channelType: ctx.channel.channelType,
    contactUid: ctx.contactUid,
    contentType: ctx.contentType,
    channelMsgId: ctx.channelMsgId ?? null,
  });

  resolveInboundMediaAsync(ctx);

  await updateConversationAfterInboundMessage(ctx);

  const intercepted = await runInboundPostbackInterceptors(ctx);
  if (intercepted) return;

  trackInboundBroadcastReply(ctx);

  await emitInboundSocketEvents(ctx);
  publishMessageReceived(ctx);
  await triggerWebhookFlow(ctx);
  await sendOutsideHoursAutoReply(ctx);

  return { conversation: ctx.conversation, message: ctx.message, duplicate: false };
}
