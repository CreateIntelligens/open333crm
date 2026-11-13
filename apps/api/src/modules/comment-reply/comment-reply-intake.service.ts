/**
 * 留言收件的資料操作（change add-comment-keyword-private-reply design D4、D9、D16-1～3、D27「verb=remove」）。
 *
 * 全部收 TenantCtx（已綁租戶的交易），不開交易、不呼叫外部服務、不排工作；交易與 outbox 由
 * comment-reply-intake.flow.ts 負責。
 *
 * 收件的冪等靠 UNIQUE (channelId, commentId)：`INSERT … ON CONFLICT DO NOTHING`。
 * 留言者對應靠 UNIQUE (channelId, externalUserId)：並行的兩則留言只會有一筆留言者、一位聯絡人。
 * 兩者都用 ON CONFLICT 而不是 catch P2002：Postgres 交易內一旦有語句失敗，整個交易就不能再用。
 */
import type { CommentReplyRule } from '@prisma/client';
import { resolveUidToContact } from '@open333crm/core';
import { channelDisplayName } from '@open333crm/shared';
import type { ParsedCommentEvent } from '@open333crm/channel-plugins';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import type { MatchableCommentRule } from './comment-reply-match.js';
import type { CommentReplyMatchMode, CommentReplyPostScope } from './comment-reply.types.js';

/** 紀錄只存留言內容的前 2,000 字（design 資料模型 commentText） */
export const COMMENT_TEXT_MAX_CHARS = 2000;

/** 收件比對用的規則欄位 */
export interface IntakeRule extends MatchableCommentRule {
  dedupePerCommenter: boolean;
  publicReplyEnabled: boolean;
}

/**
 * 某渠道啟用中、未刪除的規則，依 priority、建立時間排序（收件 flow 與試算共用，兩邊對同一則留言得到同一條規則）。
 * 與後台 API（wip/cr-routes）的 comment-reply-rule.service.ts 同名、同簽章；合併時收成一份。
 */
export async function listActiveRulesForChannel(ctx: TenantCtx, channelId: string): Promise<CommentReplyRule[]> {
  return ctx.tx.commentReplyRule.findMany({
    where: { tenantId: ctx.tenantId, channelId, isActive: true, deletedAt: null },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** 規則列轉成比對用的形狀 */
export function toIntakeRule(r: CommentReplyRule): IntakeRule {
  return { ...r, matchMode: r.matchMode as CommentReplyMatchMode, postScope: r.postScope as CommentReplyPostScope };
}

/** 渠道是否啟用（分派時已檢查，這裡在租戶交易內再確認一次，避免直接呼叫的路徑漏掉） */
export async function isChannelActive(ctx: TenantCtx, channelId: string): Promise<boolean> {
  const channel = await ctx.tx.channel.findFirst({
    where: { id: channelId, tenantId: ctx.tenantId, isActive: true },
    select: { id: true },
  });
  return channel !== null;
}

/** 這則留言是否已有紀錄（重投的快路徑：不必再建聯絡人） */
export async function hasCommentLog(ctx: TenantCtx, channelId: string, commentId: string): Promise<boolean> {
  const row = await ctx.tx.commentReplyLog.findFirst({
    where: { tenantId: ctx.tenantId, channelId, commentId },
    select: { id: true },
  });
  return row !== null;
}

export interface ResolvedCommentAuthor {
  authorId: string;
  contactId: string;
  /** 這次交易新建了留言者對應（第一次看到這位留言者） */
  createdNow: boolean;
}

/** 新聯絡人的名稱：FB 名稱、IG @帳號，都沒有時與入站一致用「<渠道名稱> User <ID 後 6 碼>」 */
export function commentAuthorDisplayName(channelType: string, event: Pick<ParsedCommentEvent, 'commenterId' | 'commenterName' | 'commenterUsername'>): string {
  if (event.commenterName) return event.commenterName;
  if (event.commenterUsername) return `@${event.commenterUsername}`;
  return `${channelDisplayName(channelType)} User ${event.commenterId.slice(-6)}`;
}

/**
 * 找或建留言者對應與聯絡人（design D16-1～3）：
 * 1. comment_authors (channelId, externalUserId) 已有 → 沿用
 * 2. 該渠道 uid 等於留言者 ID 的渠道身分（舊顧客且 ID 相同）→ 沿用其聯絡人
 * 3. IdentityMap 拼接 → 沿用其聯絡人
 * 4. 都沒有 → 建立聯絡人（createdContact = true）；此時不建渠道身分
 * 寫入留言者以 ON CONFLICT DO NOTHING：衝突表示並行的另一則留言先建了，刪掉本交易剛建、沒有任何資料的聯絡人，改用先到者。
 */
export async function resolveCommentAuthor(
  ctx: TenantCtx,
  channel: { id: string; channelType: string },
  event: Pick<ParsedCommentEvent, 'commenterId' | 'commenterName' | 'commenterUsername' | 'createdAt'>,
): Promise<ResolvedCommentAuthor> {
  const { tx, tenantId } = ctx;
  const existing = await tx.commentAuthor.findFirst({
    where: { tenantId, channelId: channel.id, externalUserId: event.commenterId },
    select: { id: true, contactId: true },
  });
  if (existing) return { authorId: existing.id, contactId: existing.contactId, createdNow: false };

  let contactId: string | null = null;
  let createdContact = false;
  const identity = await tx.channelIdentity.findFirst({
    where: { channelId: channel.id, uid: event.commenterId, contact: { tenantId } },
    select: { contactId: true },
  });
  if (identity) {
    contactId = identity.contactId;
  } else {
    const stitched = await resolveUidToContact(tx, tenantId, channel.channelType as never, event.commenterId);
    if (stitched) {
      const contact = await tx.contact.findFirst({ where: { id: stitched, tenantId }, select: { id: true } });
      contactId = contact?.id ?? null;
    }
  }
  if (!contactId) {
    const contact = await tx.contact.create({
      data: { tenantId, displayName: commentAuthorDisplayName(channel.channelType, event), language: 'zh-TW' },
      select: { id: true },
    });
    contactId = contact.id;
    createdContact = true;
  }

  const at = event.createdAt;
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO comment_authors
      (id, "tenantId", "channelId", "externalUserId", "displayName", username, "contactId", "createdContact",
       "firstCommentAt", "lastCommentAt", "commentCount", "updatedAt")
    VALUES
      (gen_random_uuid(), ${tenantId}::uuid, ${channel.id}::uuid, ${event.commenterId}, ${event.commenterName ?? null},
       ${event.commenterUsername ?? null}, ${contactId}::uuid, ${createdContact}, ${at}, ${at}, 0, now())
    ON CONFLICT ("channelId", "externalUserId") DO NOTHING
    RETURNING id`;
  if (inserted.length > 0) return { authorId: inserted[0]!.id, contactId, createdNow: true };

  // 並行的另一則留言先建了留言者：改用它，剛建的聯絡人沒有任何資料，直接刪掉
  if (createdContact) await tx.contact.deleteMany({ where: { id: contactId, tenantId } });
  const winner = await tx.commentAuthor.findFirst({
    where: { tenantId, channelId: channel.id, externalUserId: event.commenterId },
    select: { id: true, contactId: true },
  });
  if (!winner) throw new Error('comment author vanished after conflict');
  return { authorId: winner.id, contactId: winner.contactId, createdNow: false };
}

/** 紀錄插入成功後更新留言者的留言次數與最後留言時間（重投不算） */
export async function touchCommentAuthor(ctx: TenantCtx, authorId: string, at: Date): Promise<void> {
  await ctx.tx.$executeRaw`
    UPDATE comment_authors
    SET "commentCount" = "commentCount" + 1,
        "lastCommentAt" = GREATEST("lastCommentAt", ${at}),
        "updatedAt" = now()
    WHERE id = ${authorId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid`;
}

export interface PendingLogInput {
  channelId: string;
  ruleId: string;
  commentAuthorId: string;
  event: ParsedCommentEvent;
  matchedKeywords: string[];
  /** 規則開「每人一次」時 `<ruleId>:<commenterId>`（design D10） */
  dedupeKey: string | null;
  publicReplyEnabled: boolean;
}

/** 插入 PENDING 紀錄；同一則留言已有紀錄時回 null（重投、兩個入口並行） */
export async function insertPendingLog(ctx: TenantCtx, input: PendingLogInput): Promise<string | null> {
  const e = input.event;
  const text = e.text ? e.text.slice(0, COMMENT_TEXT_MAX_CHARS) : null;
  const publicReplyStatus = input.publicReplyEnabled ? 'PENDING' : 'NOT_CONFIGURED';
  const rows = await ctx.tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO comment_reply_logs
      (id, "tenantId", "channelId", "ruleId", "commentAuthorId", "commentId", "postId", "parentCommentId", "adId",
       "commenterId", "commenterName", "commenterUsername", "commentText", "commentCreatedAt", "createdAtSource",
       "matchedKeywords", status, "dedupeKey", "publicReplyStatus", "updatedAt")
    VALUES
      (gen_random_uuid(), ${ctx.tenantId}::uuid, ${input.channelId}::uuid, ${input.ruleId}::uuid, ${input.commentAuthorId}::uuid,
       ${e.commentId}, ${e.postId}, ${e.parentId ?? null}, ${e.adId ?? null},
       ${e.commenterId}, ${e.commenterName ?? null}, ${e.commenterUsername ?? null}, ${text}, ${e.createdAt}, ${e.createdAtSource},
       ${input.matchedKeywords}::text[], 'PENDING'::"CommentReplyStatus", ${input.dedupeKey}, ${publicReplyStatus}, now())
    ON CONFLICT ("channelId", "commentId") DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** 顧客刪除留言（FB verb=remove）：清空留言內容、記刪除時間；沒有紀錄時不做事（design D27） */
export async function markCommentDeleted(ctx: TenantCtx, channelId: string, commentId: string, at: Date): Promise<number> {
  const res = await ctx.tx.commentReplyLog.updateMany({
    where: { tenantId: ctx.tenantId, channelId, commentId },
    data: { commentText: null, commentDeletedAt: at },
  });
  return res.count;
}
