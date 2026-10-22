/**
 * Worker 端送訊息到 channel（LINE / FB）。
 *
 * worker 是獨立進程、沒有 fastify.io，但有 channel plugin registry + Redis。
 * 流程：查 conversation+identity → 解密 credentials → plugin.sendMessage →
 * 寫 OUTBOUND message → 透過 socket bridge emit message.new 給前端 inbox。
 *
 * 對齊 apps/api conversation.service.ts 的 deliverToChannel。
 */

import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { selectSafeLineStrategy } from '@open333crm/shared';
import { decryptCredentials } from './credentials.js';
import { publishSocketEvent } from './socket-bridge.js';

export interface DeliverPayload {
  contentType: string;
  content: Record<string, unknown>;
  delivery?: {
    strategy?: 'reply' | 'push';
    replyToken?: string;
    receivedAt?: string;
  };
}

/** 從第三方錯誤中抽出可讀原因；抽不到就回原字串（截斷避免塞爆 metadata）。 */
function describeDeliveryError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // LINE 的錯誤多半長這樣：{"message":"...","details":[{"message":"...","property":"..."}]}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        message?: string;
        details?: Array<{ message?: string; property?: string }>;
      };
      const detail = parsed.details?.find((d) => d.message)?.message;
      const combined = [parsed.message, detail].filter(Boolean).join(' — ');
      if (combined) return combined.slice(0, 500);
    } catch {
      // 不是 JSON 就沿用原字串
    }
  }
  return raw.slice(0, 500);
}

/**
 * 送出失敗時留下一則可見的紀錄。
 *
 * 刻意寫成 OUTBOUND + senderType SYSTEM，讓它出現在收件匣的對話流裡
 * （前端 MessageBubble 看到 metadata.deliveryFailed 會標成紅色失敗樣式），
 * 而不是只躺在 log 裡。這則訊息**沒有真的送到使用者端**，只給客服看。
 *
 * 本身包 try/catch：紀錄失敗不可以再把原本的錯誤蓋掉。
 */
async function recordDeliveryFailure(
  prisma: PrismaClient,
  redis: IORedis,
  conv: { id: string; tenantId: string; channel: { channelType: string } },
  payload: DeliverPayload,
  err: unknown,
  now: Date,
  record: DeliverRecordOptions = {},
): Promise<void> {
  try {
    const reason = describeDeliveryError(err);
    // 呼叫端可以換掉紀錄的內容（例如發券改寫成「規則沒有發出優惠券」），並附上自己的 metadata
    const contentType = record.failureContent ? 'text' : payload.contentType;
    const content = record.failureContent ?? payload.content;
    const message = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType,
        content: content as object,
        metadata: {
          source: 'automation',
          ...record.failureMetadata,
          deliveryFailed: true,
          deliveryError: reason,
          channelType: conv.channel.channelType,
        },
        createdAt: now,
      },
    });
    const wsPayload = {
      conversationId: conv.id,
      message: {
        id: message.id,
        conversationId: conv.id,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType,
        content,
        metadata: message.metadata,
        createdAt: now.toISOString(),
        sender: null,
      },
    };
    await publishSocketEvent(redis, `conversation:${conv.id}`, 'message.new', wsPayload);
    await publishSocketEvent(redis, `tenant:${conv.tenantId}`, 'message.new', wsPayload);
    logger.warn(`[worker:deliver] 已記錄送出失敗 conv=${conv.id}: ${reason}`);
  } catch (recordErr) {
    logger.error('[worker:deliver] 連失敗紀錄都寫不進去', recordErr);
  }
}

/** 沒有呼叫渠道就決定不送時（例如素材渠道不符），比照送出失敗在對話留下可見紀錄 */
export async function recordSkippedDelivery(
  prisma: PrismaClient,
  redis: IORedis,
  conv: { id: string; tenantId: string; channel: { channelType: string } },
  payload: DeliverPayload,
  reason: string,
): Promise<void> {
  await recordDeliveryFailure(prisma, redis, conv, payload, new Error(reason), new Date());
}

export interface DeliverRecordOptions {
  /** 送出失敗時，對話紀錄改寫成這段內容（預設為送出的內容） */
  failureContent?: Record<string, unknown>;
  /** 送出失敗紀錄額外的 metadata（例如發券的 couponIssueFailed） */
  failureMetadata?: Record<string, unknown>;
  /**
   * true：送出成功時不寫對話訊息，由呼叫端寫。
   * 發券要在確認的交易內寫券卡，券在確認前被排程作廢時才不會留下一張查無此券的券卡（design D16）
   */
  skipSuccessRecord?: boolean;
}

export type DeliverResult =
  | { ok: true; channelMsgId: string | null; sentAt: Date }
  /** recorded：失敗是否已寫成對話中看得到的紀錄（找不到對話或渠道停用時沒有寫） */
  | { ok: false; error: string; recorded: boolean };

/**
 * 把訊息送出 channel，並寫 OUTBOUND message + emit message.new。
 * 回傳是否送出成功（找不到 conversation/identity/plugin 會 return false）。
 */
export async function deliverToChannelFromWorker(
  prisma: PrismaClient,
  redis: IORedis,
  pluginRegistry: Map<string, ChannelPlugin>,
  conversationId: string,
  payload: DeliverPayload,
): Promise<boolean> {
  const result = await sendToChannelFromWorker(prisma, redis, pluginRegistry, conversationId, payload);
  return result.ok;
}

/**
 * 同 deliverToChannelFromWorker，但回傳送出結果與失敗原因，並可換掉失敗紀錄的內容、
 * 讓呼叫端自己寫成功的對話訊息（自動化發券用，design D25）。
 */
export async function sendToChannelFromWorker(
  prisma: PrismaClient,
  redis: IORedis,
  pluginRegistry: Map<string, ChannelPlugin>,
  conversationId: string,
  payload: DeliverPayload,
  record: DeliverRecordOptions = {},
): Promise<DeliverResult> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      channel: true,
      contact: { include: { channelIdentities: true } },
    },
  });

  if (!conv) {
    logger.error('[worker:deliver] Conversation not found:', conversationId);
    return { ok: false, error: '找不到對話', recorded: false };
  }
  if (!conv.channel?.isActive) {
    logger.error('[worker:deliver] Channel inactive/missing for conv:', conversationId);
    return { ok: false, error: '渠道已停用', recorded: false };
  }

  const identity = conv.contact?.channelIdentities?.find(
    (ci) => ci.channelId === conv.channel.id,
  );
  if (!identity) {
    logger.error('[worker:deliver] No channel identity for contact on channel', conv.channel.id);
    const error = '這位聯絡人沒有綁定此渠道的身分，無法送出';
    await recordDeliveryFailure(prisma, redis, conv, payload, new Error(error), new Date(), record);
    return { ok: false, error, recorded: true };
  }

  const plugin = pluginRegistry.get(conv.channel.channelType);
  if (!plugin) {
    logger.error('[worker:deliver] No plugin for channelType:', conv.channel.channelType);
    const error = `系統未載入 ${conv.channel.channelType} 渠道外掛，無法送出`;
    await recordDeliveryFailure(prisma, redis, conv, payload, new Error(error), new Date(), record);
    return { ok: false, error, recorded: true };
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = decryptCredentials(conv.channel.credentialsEncrypted);
  } catch (err) {
    logger.error('[worker:deliver] Failed to decrypt credentials:', err);
    // 踩過：用別的環境金鑰加密的 token 在這裡解不開，症狀就是「訊息都沒送出」
    // 但完全沒有線索。原因寫死成人話，不要把解密錯誤原文外洩。
    const error = '渠道憑證無法解密，請到渠道設定重新填寫金鑰';
    await recordDeliveryFailure(prisma, redis, conv, payload, new Error(error), new Date(), record);
    return { ok: false, error, recorded: true };
  }

  const now = new Date();

  // 1. 呼叫 channel plugin 送出
  let channelMsgId: string | undefined;
  try {
    const safeStrategy = conv.channel.channelType === 'LINE' && payload.delivery
      ? selectSafeLineStrategy(payload.delivery)
      : undefined;
    const strategy = safeStrategy ?? (payload.delivery?.strategy ?? 'push');
    const send = async (selectedStrategy: 'reply' | 'push') => {
      const content = {
        ...payload.content,
        strategy: selectedStrategy,
        ...(selectedStrategy === 'reply' && payload.delivery?.replyToken
          ? { replyToken: payload.delivery.replyToken }
          : {}),
      };
      const result = await plugin.sendMessage(identity.uid, { contentType: payload.contentType, content }, credentials);
      if (!result.success) throw new Error(result.error || `channel ${selectedStrategy} delivery failed`);
      return result;
    };
    let result;
    try {
      result = await send(strategy);
    } catch (error) {
      if (strategy === 'reply') {
        logger.warn('[SafeReply] worker LINE reply failed; falling back to push', { conversationId, error });
        result = await send('push');
      } else {
        throw error;
      }
    }
    channelMsgId = result.channelMsgId;
  } catch (err) {
    // ⚠️ 送出失敗不能只寫 log 就算了。
    // 2026-09-23 測試人員回報「AI 模式不觸發關鍵字素材」，實際上關鍵字有觸發，
    // 是影片素材用 Google Drive 分享連結被 LINE 拒收——但後台完全看不出來，
    // 使用者只覺得「沒反應」，查了很久才從 DB 比對出來（log 那時已輪替掉）。
    // 所以這裡把失敗也寫成一則訊息，讓它在收件匣裡看得見。
    logger.error('[worker:deliver] plugin.sendMessage threw:', err);
    await recordDeliveryFailure(prisma, redis, conv, payload, err, now, record);
    return { ok: false, error: describeDeliveryError(err), recorded: true };
  }

  if (record.skipSuccessRecord) {
    logger.info(`[worker:deliver] sent ${payload.contentType} to conv=${conversationId} uid=${identity.uid}（對話訊息由呼叫端寫入）`);
    return { ok: true, channelMsgId: channelMsgId ?? null, sentAt: now };
  }

  // 2. 寫 OUTBOUND message 進 DB
  const message = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: payload.contentType,
      content: payload.content as object,
      channelMsgId: channelMsgId ?? null,
      metadata: { source: 'automation' },
      createdAt: now,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now },
  });

  // 3. emit message.new 給前端 inbox（透過 redis socket bridge）
  const wsPayload = {
    conversationId,
    message: {
      id: message.id,
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: payload.contentType,
      content: payload.content,
      createdAt: now.toISOString(),
      sender: null,
    },
  };
  await publishSocketEvent(redis, `conversation:${conversationId}`, 'message.new', wsPayload);
  await publishSocketEvent(redis, `tenant:${conv.tenantId}`, 'message.new', wsPayload);

  logger.info(`[worker:deliver] sent ${payload.contentType} to conv=${conversationId} uid=${identity.uid}`);
  return { ok: true, channelMsgId: channelMsgId ?? null, sentAt: now };
}

/**
 * 遞迴替換 body 內的 {{key}} 變數（對齊 api template-renderer，worker 端輕量複製）。
 */
export function renderTemplateBody<T>(body: T, variables: Record<string, string>): T {
  if (typeof body === 'string') {
    return body.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_m, key: string) =>
      variables[key] !== undefined ? variables[key] : `{{${key}}}`,
    ) as unknown as T;
  }
  if (Array.isArray(body)) {
    return body.map((item) => renderTemplateBody(item, variables)) as unknown as T;
  }
  if (body !== null && typeof body === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      result[k] = renderTemplateBody(v, variables);
    }
    return result as T;
  }
  return body;
}
