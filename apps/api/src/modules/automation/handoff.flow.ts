/**
 * 機器人轉接真人的共用步驟（issue #419）：自動轉接（automation.worker 的 checkAutoHandoff）與
 * 知識庫自動回覆的追問用完、AI 失敗（kb-autoreply.service）都走這裡。
 *
 * 在呼叫端的交易內（bot_reply 認領的 replyGuard.persist）執行：
 * - 條件更新對話為 AGENT_HANDLED、寫轉真人原因與系統訊息（handoff.service）
 * - 同一個交易發出 conversation.handoff（outbox；通知訂閱者據此通知客服）
 * - commit 之後推播 conversation.updated 與系統訊息的 message.new 到渠道房間（notifyChannel，#427）
 * 對話已不是 BOT_HANDLED 時回傳 null，什麼都不做；呼叫端應讓交易 rollback，不送出轉接訊息。
 */
import type { Server } from 'socket.io';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import type { TenantScope } from '../../lib/tenant-ctx.js';
import { notifyChannel } from '../../events/socket-push.js';
import { publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import { markConversationHandedOff, type MarkHandedOffInput } from './handoff.service.js';

export interface HandoffDeps {
  io: Server;
  events: EventPublisher;
}

export interface HandOffInput extends MarkHandedOffInput {
  channelId: string;
  /** Bot 對話摘要（自動轉接才有）；放進 conversation.handoff */
  summary?: string;
}

export async function handOffConversation(scope: TenantScope, deps: HandoffDeps, input: HandOffInput) {
  const result = await markConversationHandedOff(scope, input);
  if (!result) return null;

  const { conversationId, reason, channelId } = input;
  await publishEvent(scope, deps.events, 'conversation.handoff', {
    conversationId,
    reason,
    summary: input.summary ?? '',
    previousStatus: 'BOT_HANDLED',
  });

  const target = { channelId, conversationId };
  const { conversation, systemMessage } = result;
  if (conversation) {
    const payload: ConversationUpdatedPayload = {
      id: conversation.id,
      status: conversation.status,
      assignedToId: conversation.assignedToId,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      updatedAt: conversation.updatedAt.toISOString(),
      handoffReason: reason,
    };
    notifyChannel(scope, deps.io, target, 'conversation.updated', payload);
  }
  notifyChannel(scope, deps.io, target, 'message.new', {
    conversationId,
    message: {
      id: systemMessage.id,
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'system',
      content: systemMessage.content,
      createdAt: (input.systemCreatedAt ?? input.now).toISOString(),
      sender: null,
    },
  });
  return result;
}
