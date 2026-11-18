/**
 * 入站與留言自動私訊的銜接（change add-comment-keyword-private-reply design D16「私訊失敗時」、D17、D18）。
 *
 * - findCommentAuthorContact：新 UID 第一次進站、建立聯絡人之前，先查該渠道的留言者對應
 *   （psid 或留言者 ID 等於 uid、聯絡人未封存）→ 把渠道身分建在那位聯絡人（inbound-contact-resolution MODIFIED）
 * - resolveCommentContactEvent：聯絡人是留言收件建立的 → 不送招呼語；第一次進站時以條件更新認領後發一次 contact.created
 *   （只在有留言擴充的 FB／IG 渠道判斷，見函式內說明）
 * - attachInboundCommentOrigin：顧客訊息落地後，關聯留言私訊紀錄、補入系統訊息與私訊快照（失敗只記 log）
 *
 * 留言收件端（comment-reply-intake.service.ts、comment-reply-contact.service.ts）也有建立聯絡人與身分的邏輯，兩處要同步。
 */
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { attachCommentOrigin } from '../comment-reply/comment-reply-inbox.service.js';
import type { InboundMessageContext } from './inbound-message.types.js';

/** 該渠道 psid 或留言者 ID 等於 uid 的留言者，其聯絡人未封存時回傳聯絡人 ID */
export async function findCommentAuthorContact(ctx: InboundMessageContext): Promise<string | null> {
  if (!ctx.plugin?.extensions?.comments) return null;
  const author = await ctx.prisma.commentAuthor.findFirst({
    where: {
      tenantId: ctx.tenantId,
      channelId: ctx.channel.id,
      OR: [{ psid: ctx.contactUid }, { externalUserId: ctx.contactUid }],
      contact: { isArchived: false },
    },
    orderBy: { createdAt: 'asc' },
    select: { contactId: true },
  });
  return author?.contactId ?? null;
}

/**
 * 聯絡人是否由留言收件建立（D17）。是的話：
 * - ctx.fromCommentReply = true（sendFirstContactGreeting 不送招呼語）
 * - 第一次進站時認領 contactEventPublishedAt，認領成功回傳 true（呼叫端發一次 contact.created）
 */
export async function resolveCommentContactEvent(ctx: InboundMessageContext, contactId: string): Promise<boolean> {
  // 只在有留言擴充的渠道判斷：留言建立的聯絡人第一次進站幾乎一定是回覆留言私訊（同一個 FB／IG 渠道）。
  // 其他渠道（LINE 等）的進站不多查一次（取捨：經合併或 IdentityMap 才可能先從其他渠道進站，屆時照一般新聯絡人處理）
  if (!ctx.plugin?.extensions?.comments) return false;
  const author = await ctx.prisma.commentAuthor.findFirst({
    where: { tenantId: ctx.tenantId, contactId, createdContact: true },
    select: { id: true },
  });
  if (!author) return false;
  ctx.fromCommentReply = true;
  const claimed = await ctx.prisma.commentAuthor.updateMany({
    where: { tenantId: ctx.tenantId, contactId, createdContact: true, contactEventPublishedAt: null },
    data: { contactEventPublishedAt: ctx.now },
  });
  // 同一位聯絡人可能有多筆留言者對應（FB 與 IG 各一筆）：任一筆被認領過就不再發
  const already = await ctx.prisma.commentAuthor.count({
    where: { tenantId: ctx.tenantId, contactId, createdContact: true, contactEventPublishedAt: { not: null, lt: ctx.now } },
  });
  return claimed.count > 0 && already === 0;
}

/** 顧客訊息落地後呼叫；只對有留言擴充的渠道。失敗只記 log，不影響顧客訊息落地與推播 */
export async function attachInboundCommentOrigin(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.plugin?.extensions?.comments || !ctx.conversation) return;
  if (ctx.message?.direction && ctx.message.direction !== 'INBOUND') return;
  try {
    await inTenant(ctx.options.tenantPrisma ?? ctx.prisma, ctx.tenantId, (scope) =>
      attachCommentOrigin(scope, {
        channelId: ctx.channel.id,
        uid: ctx.contactUid,
        conversationId: ctx.conversation!.id,
        repliedAt: ctx.message?.createdAt ?? ctx.now,
      }),
    );
  } catch (err) {
    logger.error('[Webhook] 留言私訊與對話的關聯失敗', {
      tenantId: ctx.tenantId,
      channelId: ctx.channel.id,
      conversationId: ctx.conversation.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
