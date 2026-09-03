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
import type IORedis from 'ioredis';
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
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      channel: true,
      contact: { include: { channelIdentities: true } },
    },
  });

  if (!conv) {
    logger.error('[worker:deliver] Conversation not found:', conversationId);
    return false;
  }
  if (!conv.channel?.isActive) {
    logger.error('[worker:deliver] Channel inactive/missing for conv:', conversationId);
    return false;
  }

  const identity = conv.contact?.channelIdentities?.find(
    (ci) => ci.channelId === conv.channel.id,
  );
  if (!identity) {
    logger.error('[worker:deliver] No channel identity for contact on channel', conv.channel.id);
    return false;
  }

  const plugin = pluginRegistry.get(conv.channel.channelType);
  if (!plugin) {
    logger.error('[worker:deliver] No plugin for channelType:', conv.channel.channelType);
    return false;
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = decryptCredentials(conv.channel.credentialsEncrypted);
  } catch (err) {
    logger.error('[worker:deliver] Failed to decrypt credentials:', err);
    return false;
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
    logger.error('[worker:deliver] plugin.sendMessage threw:', err);
    return false;
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
  return true;
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
