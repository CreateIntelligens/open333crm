/**
 * coupon 模組的推播與事件（change migrate-role-agent-tenant-ctx，design 決策 8）。
 *
 * service 只回傳結果；flow 與入口依結果呼叫這裡的函式。同一種推播有多個入口
 * （例如核銷有 4 個入口），推播的內容在這裡組一次，入口不各自組。
 */
import type { Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import type { TenantScope } from '../../lib/tenant-ctx.js';
import { notifyTenant } from '../../events/socket-push.js';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { publishContactTagged } from '../tag/tag-effects.js';

export type InstanceChange = 'issued' | 'viewed' | 'redeemed';

/** 收件匣「已發優惠券」重新載入（add-coupon-system design D23） */
export function notifyInstanceUpdated(
  scope: TenantScope,
  io: Server,
  update: { instanceId: string; contactId: string | null; change: InstanceChange },
): void {
  notifyTenant(scope, io, 'coupon.instance.updated', update);
}

/** 對話新增一則訊息（發券或領券的券卡、沒有發出券時的回覆） */
export function notifyCouponMessage(
  scope: TenantScope,
  io: Server,
  message: Prisma.MessageGetPayload<object> & { sender?: unknown },
): void {
  notifyTenant(scope, io, 'message.new', {
    conversationId: message.conversationId,
    message: {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      senderId: message.senderId,
      contentType: message.contentType,
      content: message.content,
      type: message.contentType,
      payload: message.content,
      metadata: message.metadata,
      createdAt: message.createdAt.toISOString(),
      sequence: message.sequence,
      sender: message.sender,
    },
  });
}

/** 發券時貼上的標籤：與資料一起寫進 outbox，貼標的自動化規則由這個事件觸發 */
export function publishCouponTag(
  scope: TenantScope,
  events: EventPublisher,
  contactId: string,
  tag: { tagId: string; tagName: string },
): Promise<void> {
  return publishContactTagged(scope, events, { contactId, tagId: tag.tagId, tagName: tag.tagName, source: 'system' });
}
