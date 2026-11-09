/**
 * 機器人把對話轉給真人（bot-handoff-config「自動轉接每次只發生一次」、
 * 「知識庫追問用完或 AI 失敗時轉接真人」，issue #419）。
 *
 * 只做資料：以條件更新把對話從 BOT_HANDLED 改成 AGENT_HANDLED，成功才寫系統訊息。
 * 事件與推播由 handoff.flow.ts 決定。
 */
import type { Prisma } from '@prisma/client';
import { claimOne } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

export interface MarkHandedOffInput {
  conversationId: string;
  /** 寫進 conversation.handoffReason，客服看得到為什麼轉接 */
  reason: string;
  now: Date;
  /** 已遮罩的系統訊息內容（prepareStoredMessageContent 的結果），在交易外準備 */
  systemContent: Prisma.InputJsonObject;
  systemMetadata: Prisma.InputJsonObject;
  /** 系統訊息的時間；同一個交易先寫了機器人回覆時晚 1 毫秒，收件匣才會先顯示回覆 */
  systemCreatedAt?: Date;
}

/**
 * 回傳 null：對話已不是 BOT_HANDLED（另一個處理已轉接，或客服已接手），沒有寫入任何資料。
 */
export async function markConversationHandedOff(ctx: TenantCtx, input: MarkHandedOffInput) {
  const { conversationId, reason, now } = input;
  // 系統訊息是這個交易最後寫的一則，對話的最後訊息時間與它一致
  const systemCreatedAt = input.systemCreatedAt ?? now;
  const claimed = await claimOne(() =>
    ctx.tx.conversation.updateMany({
      where: { id: conversationId, tenantId: ctx.tenantId, status: 'BOT_HANDLED' },
      data: { status: 'AGENT_HANDLED', handoffReason: reason, lastMessageAt: systemCreatedAt },
    }),
  );
  if (!claimed) return null;

  const systemMessage = await ctx.tx.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'system',
      content: input.systemContent,
      metadata: input.systemMetadata,
      isRead: true,
      createdAt: systemCreatedAt,
    },
  });
  const conversation = await ctx.tx.conversation.findFirst({ where: { id: conversationId, tenantId: ctx.tenantId } });
  return { systemMessage, conversation };
}
