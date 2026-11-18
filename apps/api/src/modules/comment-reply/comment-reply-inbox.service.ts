/**
 * 顧客回覆留言私訊時串到收件匣（change add-comment-keyword-private-reply design D18）。
 *
 * attachCommentOrigin() 在顧客訊息落地後、推播前呼叫（入站），以及寫 SENT 之後顧客已回覆時呼叫（顧客回覆比 T2 先到）。
 * 兩條路都靠「conversationId IS NULL 才更新」的條件更新，一筆紀錄只關聯一次：
 * 1. 找該渠道 recipientUid = 發送者、SENT、尚未關聯對話、30 天內送出的最新一筆紀錄
 * 2. 條件更新 conversationId、customerRepliedAt；0 列表示別的請求已處理
 * 3. 補入系統訊息（createdAt = sentAt − 1ms）與私訊快照（createdAt = sentAt，channelMsgId = 私訊的 message_id）；
 *    快照以 skipDuplicates 寫入：Meta 送回的 echo 若已用同一個 message_id 落地，不重複也不讓交易失敗
 * 4. 對話的 originCommentReplyLogId 為空才寫入（保留第一個來源）
 * 補入的訊息不改 lastMessageAt、未讀數（顧客那則已更新；補入的時間早於顧客訊息，排序自然正確）。
 *
 * 前端依 metadata.source = 'comment_private_reply'、kind = 'origin_note' 顯示（planning/02 §6.5）。
 */
import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

export const COMMENT_ORIGIN_SOURCE = 'comment_private_reply';
/** 30 天前送出的私訊不再關聯（顧客很久以後才回覆，與留言無關的機率高） */
export const COMMENT_ORIGIN_WINDOW_MS = 30 * 24 * 3600_000;
const COMMENT_EXCERPT_CHARS = 100;

export interface AttachCommentOriginInput {
  channelId: string;
  /** 發送者的 uid（PSID／IGSID） */
  uid: string;
  conversationId: string;
  /** 顧客第一則回覆的時間 */
  repliedAt: Date;
  now?: Date;
}

export type AttachCommentOriginResult = { attached: false } | { attached: true; logId: string };

export async function attachCommentOrigin(ctx: TenantCtx, input: AttachCommentOriginInput): Promise<AttachCommentOriginResult> {
  const { tx, tenantId } = ctx;
  const now = input.now ?? new Date();
  const log = await tx.commentReplyLog.findFirst({
    where: {
      tenantId,
      channelId: input.channelId,
      recipientUid: input.uid,
      status: 'SENT',
      conversationId: null,
      sentAt: { gte: new Date(now.getTime() - COMMENT_ORIGIN_WINDOW_MS) },
    },
    orderBy: { sentAt: 'desc' },
    select: {
      id: true,
      sentAt: true,
      sentMessageId: true,
      sentContentSnapshot: true,
      commentText: true,
      rule: { select: { name: true } },
    },
  });
  if (!log?.sentAt) return { attached: false };

  const claimed = await tx.commentReplyLog.updateMany({
    where: { id: log.id, tenantId, conversationId: null },
    data: { conversationId: input.conversationId, customerRepliedAt: input.repliedAt },
  });
  if (claimed.count === 0) return { attached: false };

  const snapshot = (log.sentContentSnapshot ?? {}) as { contentType?: unknown; content?: unknown };
  const excerpt = log.commentText ? log.commentText.slice(0, COMMENT_EXCERPT_CHARS) : null;
  const note = excerpt
    ? `此對話來自貼文留言：顧客留言「${excerpt}」，系統依規則「${log.rule.name}」自動私訊。`
    : `此對話來自貼文留言，系統依規則「${log.rule.name}」自動私訊。`;

  const messages: Prisma.MessageCreateManyInput[] = [
    {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'text',
      content: { text: note },
      metadata: { source: COMMENT_ORIGIN_SOURCE, kind: 'origin_note', logId: log.id },
      createdAt: new Date(log.sentAt.getTime() - 1),
    },
    {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: typeof snapshot.contentType === 'string' ? snapshot.contentType : 'text',
      content: (snapshot.content ?? {}) as Prisma.InputJsonValue,
      metadata: { source: COMMENT_ORIGIN_SOURCE, kind: 'private_reply', logId: log.id },
      channelMsgId: log.sentMessageId,
      createdAt: log.sentAt,
    },
  ];
  await tx.message.createMany({ data: messages, skipDuplicates: true });

  await tx.conversation.updateMany({
    where: { id: input.conversationId, tenantId, originCommentReplyLogId: null },
    data: { originCommentReplyLogId: log.id },
  });
  return { attached: true, logId: log.id };
}

/**
 * 寫 SENT 之後：顧客回覆比 T2 先到時（入站當下找不到 SENT 紀錄），找出該身分在這個渠道、
 * 第一則進站訊息晚於私訊送出時間的對話，交給 attachCommentOrigin()。
 */
export async function findConversationRepliedAfter(
  ctx: TenantCtx,
  input: { channelId: string; uid: string; sentAt: Date },
): Promise<{ conversationId: string; repliedAt: Date } | null> {
  const identity = await ctx.tx.channelIdentity.findFirst({
    where: { channelId: input.channelId, uid: input.uid, contact: { tenantId: ctx.tenantId } },
    select: { contactId: true },
  });
  if (!identity) return null;
  const message = await ctx.tx.message.findFirst({
    where: {
      direction: 'INBOUND',
      createdAt: { gte: input.sentAt },
      conversation: { tenantId: ctx.tenantId, channelId: input.channelId, contactId: identity.contactId },
    },
    orderBy: { createdAt: 'asc' },
    select: { conversationId: true, createdAt: true },
  });
  return message ? { conversationId: message.conversationId, repliedAt: message.createdAt } : null;
}
