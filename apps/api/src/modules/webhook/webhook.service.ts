import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import type { ChannelPlugin, ParsedWebhookMessage } from '@open333crm/channel-plugins';
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
import { handleReferralEvent, interceptIdentityBinding } from './inbound-identity-binding.js';
import {
  emitInboundSocketEvents,
  publishMessageReceived,
  resolveInboundMediaAsync,
  sendOutsideHoursAutoReply,
  sendFirstContactGreeting,
  trackInboundBroadcastReply,
  triggerWebhookFlow,
} from './inbound-side-effects.js';
import { forwardToDownstream, getDownstreamWebhookConfig } from './downstream-forwarder.js';
import { claimForForward } from './downstream-loop-guard.js';
import { recordRoutingWarning, routePlatformMessages, routeWebhookMessages } from './webhook-account-routing.js';
import { getMetaAppConfig } from '../meta-connect/meta-connect.service.js';

// TODO(rls): 入站 webhook 為公開端點（無認證租戶），tenant 由 channel 反查得出，
// 且下游 resolver / InboundMessageContext 皆以 PrismaClient 型別串接，故此路徑不套 RLS，維持 PrismaClient。
/** 進站 webhook 被拒的原因（AUDIT CHAN-03） */
export type WebhookRejectReason =
  | 'channel_not_found'
  | 'tenant_disabled'
  | 'channel_type_mismatch'
  | 'no_plugin'
  | 'invalid_signature';

async function loadWebhookChannel(prisma: PrismaClient, channelId: string) {
  return prisma.channel.findFirst({
    where: { id: channelId, isActive: true },
    include: { tenant: { select: { isActive: true } } },
  });
}

export interface VerifiedWebhook {
  channel: NonNullable<Awaited<ReturnType<typeof loadWebhookChannel>>>;
  plugin: ChannelPlugin;
  credentials: Record<string, unknown>;
  secret: string;
}

export type WebhookVerification =
  | { ok: true; verified: VerifiedWebhook }
  | { ok: false; reason: WebhookRejectReason };

/**
 * 載入網址的渠道並驗證簽章，不處理事件。
 * LINE 路由在回應前呼叫，驗簽失敗時回 403（主規格 line-webhook-events）；processWebhookEvent 也以此為第一步。
 */
export async function verifyWebhookRequest(
  prisma: PrismaClient,
  channelId: string,
  channelType: string,
  rawBody: Buffer | undefined,
  headers: Record<string, string>,
): Promise<WebhookVerification> {
  // 1. Load channel from DB（一併載入所屬租戶的啟用狀態）
  const channel = await loadWebhookChannel(prisma, channelId);

  if (!channel) {
    logger.warn('[Webhook] Channel not found or inactive', { channelId });
    return { ok: false, reason: 'channel_not_found' };
  }

  // 租戶被停用（例如欠費停權）時，即使 channel 本身 active 也不處理其 inbound 訊息。
  // 用 optional chaining 防孤兒列。
  if (!channel.tenant?.isActive) {
    logger.warn('[Webhook] Tenant is disabled, dropping event', { channelId, tenantId: channel.tenantId });
    return { ok: false, reason: 'tenant_disabled' };
  }

  // 網址的路由類型必須與渠道本身的類型一致；否則會以其他類型的外掛與憑證處理（AUDIT CHAN-03）
  if (channel.channelType !== channelType) {
    logger.warn('[Webhook] Channel type does not match the webhook route, dropping event', {
      channelId, routeType: channelType, channelType: channel.channelType,
    });
    return { ok: false, reason: 'channel_type_mismatch' };
  }
  logger.info('[Webhook] Channel found', { channelId, channelType: channel.channelType, tenantId: channel.tenantId });

  // 2. Get plugin and decrypt credentials
  const plugin = getChannelPlugin(channelType);
  if (!plugin) {
    logger.warn('[Webhook] No plugin registered for channel type', { channelType });
    return { ok: false, reason: 'no_plugin' };
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  // 簽章驗證用的 secret：FB 與 IG(THREADS) 用 App Secret（X-Hub-Signature-256），
  // LINE 等其餘用 channelSecret。THREADS 若誤用 channelSecret 會永遠驗簽失敗。
  const secret = (channelType === CHANNEL_TYPE.FB || channelType === CHANNEL_TYPE.THREADS
    ? credentials.appSecret
    : credentials.channelSecret) as string;

  logger.info('[Webhook] Verifying signature', { channelId, channelType, hasSecret: !!secret });

  // 3. Verify signature
  if (!secret) {
    logger.error('[Webhook] Channel has no signing secret configured', { channelId, channelType });
    return { ok: false, reason: 'invalid_signature' };
  }
  // 外掛驗簽拋出錯誤（例如重複的標頭讓值變成陣列）是格式錯誤的請求，視為驗簽失敗，不當成伺服器錯誤
  let signatureOk = false;
  if (rawBody) {
    try {
      signatureOk = plugin.verifySignature(rawBody, headers, secret);
    } catch (err) {
      logger.warn('[Webhook] Signature verification threw', { channelId, channelType, error: (err as Error)?.message });
    }
  }
  if (!signatureOk) {
    logger.warn('[Webhook] Signature verification failed', { channelId, channelType });
    return { ok: false, reason: 'invalid_signature' };
  }
  logger.info('[Webhook] Signature OK', { channelId, channelType });

  return { ok: true, verified: { channel, plugin, credentials, secret } };
}

export async function processWebhookEvent(
  prisma: PrismaClient,
  io: SocketIOServer,
  channelId: string,
  channelType: string,
  rawBody: Buffer,
  headers: Record<string, string>,
  /** 路由已在回應前驗簽時傳入，避免重複查詢與驗簽 */
  preverified?: VerifiedWebhook,
) {
  logger.info('[Webhook] Received', { channelId, channelType, bodyBytes: rawBody?.length ?? 0 });

  let verified = preverified;
  if (!verified) {
    const result = await verifyWebhookRequest(prisma, channelId, channelType, rawBody, headers);
    if (!result.ok) {
      switch (result.reason) {
        case 'channel_not_found':
          throw new Error(`Channel not found or inactive: ${channelId}`);
        case 'no_plugin':
          throw new Error(`No plugin for channel type: ${channelType}`);
        case 'invalid_signature':
          throw new Error('Invalid webhook signature');
        // 租戶停用與類型不符是預期內情況（非錯誤）：route 早已回 200，安靜丟棄即可
        case 'tenant_disabled':
        case 'channel_type_mismatch':
          return;
      }
    }
    verified = result.verified;
  }
  const { channel, plugin, credentials, secret } = verified;
  const tenantId = channel.tenantId;

  // 4. Parse webhook into normalized messages
  const parsedMessages = await plugin.parseWebhook(rawBody, headers);

  logger.info('[Webhook] Parsed', {
    channelId,
    channelType,
    count: parsedMessages.length,
    messages: parsedMessages.map(m => ({ contactUid: m.contactUid, contentType: m.contentType, channelMsgId: m.channelMsgId, accountId: m.accountId })),
  });

  if (parsedMessages.length === 0) {
    logger.info('[Webhook] No actionable messages in payload', { channelId, channelType });
  }

  // 5. FB／IG 依事件的帳號 ID（entry.id）分派到真正的渠道與租戶；多個粉專共用同一個 Meta App 時，
  //    別的粉專的事件不會再落進網址渠道（change fix-meta-webhook-page-routing）。其他渠道類型原樣回傳。
  const routing = await routeWebhookMessages(
    prisma,
    { id: channel.id, tenantId, channelType: channel.channelType, externalAccountId: channel.externalAccountId },
    credentials,
    secret,
    parsedMessages,
  );

  // 6. Downstream webhook forwarding (any channel). See openspec `line-downstream-webhook`.
  //    轉發的是原始 body 與簽章，無法拆包重簽：只有整包都屬於網址渠道時才轉發，
  //    否則會把別的渠道（甚至別的租戶）的事件轉給網址渠道設定的下游。
  const downstream = getDownstreamWebhookConfig(channel.settings);
  const canForward = routing.allToUrlChannel;
  if (downstream && !canForward) {
    logger.warn('[Webhook] Payload contains events of other channels — downstream forward skipped', { channelId });
    await recordRoutingWarning(prisma, { id: channel.id, tenantId }, 'downstream_skipped');
  }
  const immediate = downstream?.mode === 'immediate';
  if (downstream && immediate && canForward) {
    // Immediate mode: forward the original payload, then short-circuit —
    // skip CRM inbound processing (downstream takes over).
    // Loop guard: if the downstream shot our own forward back, drop it.
    if (await claimForForward(channelId, rawBody)) {
      logger.info('[Webhook] Downstream immediate — forwarding and short-circuiting', { channelId });
      void forwardToDownstream(downstream, rawBody, headers, channel);
    } else {
      logger.warn('[Webhook] Downstream loopback detected — dropping (immediate)', { channelId });
    }
    return;
  }

  // 7. Process each message with its routed channel and tenant (same pattern as simulator.service.ts)
  //    immediate 模式卻因混包無法轉發時，網址渠道自己的事件改由 CRM 處理——寧可重複處理也不能讓訊息消失。
  for (const group of routing.groups) {
    if (group.channel.id !== channel.id) {
      logger.info('[Webhook] Routed events to channel by account ID', {
        urlChannelId: channel.id,
        targetChannelId: group.channel.id,
        count: group.messages.length,
      });
      // 改派過來的事件無法轉發給目標渠道自己的下游（原始 body 含其他帳號、簽章無法拆包重簽）：
      // 照常進 CRM，並在目標渠道留警示，讓設了下游的管理員知道這些事件沒轉出去
      if (getDownstreamWebhookConfig(group.settings)) {
        await recordRoutingWarning(prisma, group.channel, 'downstream_skipped');
      }
    }
    for (const parsed of group.messages) {
      await processInboundMessage(prisma, io, group.credentials, group.channel, group.channel.tenantId, parsed);
    }
  }

  // 8. Downstream "after" mode: CRM processing done, now forward a copy.
  //    Loop guard: skip forwarding a payload the downstream shot back at us.
  if (downstream && downstream.mode === 'after' && canForward) {
    if (await claimForForward(channelId, rawBody)) {
      void forwardToDownstream(downstream, rawBody, headers, channel);
    } else {
      logger.warn('[Webhook] Downstream loopback detected — skip forward (after)', { channelId });
    }
  }
}

/**
 * 平台 Meta App 的 webhook（/api/v1/webhooks/meta，change fix-meta-webhook-page-routing 第 3 階段）。
 * 以平台 App Secret 驗簽，依 object 決定渠道類型（page → FB、instagram → IG），
 * 再依 entry.id 交給以 Facebook 登入連結的渠道。平台層事件不做下游轉發。
 */
export async function processPlatformMetaWebhook(
  prisma: PrismaClient,
  io: SocketIOServer,
  rawBody: Buffer,
  headers: Record<string, string>,
) {
  const cfg = getMetaAppConfig();
  if (!cfg) throw new Error('Platform Meta App is not configured');

  let object: unknown;
  try {
    object = (JSON.parse(rawBody.toString('utf-8')) as { object?: unknown }).object;
  } catch {
    throw new Error('Invalid webhook payload');
  }
  const channelType = object === 'page' ? CHANNEL_TYPE.FB : object === 'instagram' ? CHANNEL_TYPE.THREADS : null;
  if (!channelType) {
    logger.info('[Webhook:meta] 不處理的 object，略過', { object });
    return;
  }
  const plugin = getChannelPlugin(channelType);
  if (!plugin) throw new Error(`No plugin for channel type: ${channelType}`);
  if (!plugin.verifySignature(rawBody, headers, cfg.appSecret)) {
    logger.warn('[Webhook:meta] Signature verification failed', { channelType });
    throw new Error('Invalid webhook signature');
  }

  const parsed = await plugin.parseWebhook(rawBody, headers);
  const groups = await routePlatformMessages(prisma, channelType, parsed);
  for (const group of groups) {
    for (const message of group.messages) {
      await processInboundMessage(prisma, io, group.credentials, group.channel, group.channel.tenantId, message);
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

  // FB／IG 點 m.me／ig.me 連結產生的 referral 事件只帶 ref、沒有訊息內容，不落地成收件匣訊息
  if (ctx.contentType === 'referral') {
    await handleReferralEvent(ctx, async (c) => {
      await resolveInboundContact(c);
      await resolveInboundConversation(c);
    });
    return;
  }

  await resolveInboundContact(ctx);
  await resolveInboundConversation(ctx);

  const duplicate = await findDuplicateInboundMessage(ctx);
  if (duplicate) return duplicate;

  // 併發競態下撞 unique 約束（平台同一 webhook 幾乎同時重投）→ 視為重複，提早結束
  const created = await createInboundMessage(ctx);
  if (!created) {
    return { conversation: ctx.conversation!, message: ctx.message!, duplicate: true };
  }

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

  // 跨渠道綁定（綁定關鍵字／代碼／確認／解除）：命中時不跑其他攔截與 AI／關鍵字／自動化。
  // 招呼語由攔截內部在綁定回覆之前送出（見 interceptIdentityBinding）
  const binding = await interceptIdentityBinding(ctx);
  if (binding.handled) {
    return { conversation: ctx.conversation, message: ctx.message, duplicate: false };
  }

  // 招呼語放在 postback 攔截之前：攔截命中（CSAT/KB 回饋/轉真人）會提早 return，
  // 那些情境雖不太可能是首次進站，但招呼語沒有理由被它們跳過。
  await sendFirstContactGreeting(ctx);

  const intercepted = await runInboundPostbackInterceptors(ctx);
  if (intercepted) return;

  trackInboundBroadcastReply(ctx);

  await emitInboundSocketEvents(ctx);
  publishMessageReceived(ctx);
  await triggerWebhookFlow(ctx);
  await sendOutsideHoursAutoReply(ctx);

  return { conversation: ctx.conversation, message: ctx.message, duplicate: false };
}
