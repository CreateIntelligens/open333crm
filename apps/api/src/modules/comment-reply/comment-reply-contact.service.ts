/**
 * 私訊成功後以 recipient_id 接上同一個人（change add-comment-keyword-private-reply design D16-4、D16-5）。
 *
 * 在寫 SENT 的同一個交易內呼叫：
 * - 該渠道沒有 uid = recipient_id 的渠道身分 → 建在留言者的聯絡人下，comment_authors.psid = recipient_id
 *   （以 ON CONFLICT DO NOTHING 寫入：顧客回覆的 webhook 可能先建了，衝突時走下一點）
 * - 已存在且屬於另一位聯絡人 X：
 *     留言者的聯絡人 A 是留言收件建立的（createdContact）且未封存 → 以既有合併引擎把 A 併入 X（source = COMMENT_REPLY，可解除）
 *     A 原本就存在 → 不自動合併，只把留言者對應改指 X，記 warning log
 * 不呼叫 getProfile()、不發 contact.created、不送招呼語（D17）。
 *
 * 入站的 resolveInboundContact()（webhook/inbound-contact-resolver.ts）也有「建渠道身分」的邏輯，兩處要同步。
 */
import { logger } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { mergeContacts } from '../contact/contact-merge.service.js';
import { AppError } from '../../shared/utils/response.js';

export interface LinkRecipientInput {
  channel: { id: string; channelType: string };
  commentAuthorId: string;
  recipientUid: string;
  /** 留言事件的留言者 ID（FB from.id／IG IGSID），與 recipient_id 不同時記 warning */
  commenterId: string | null;
}

export type LinkRecipientResult =
  | { kind: 'created'; contactId: string }
  | { kind: 'existing'; contactId: string }
  | { kind: 'merged'; contactId: string; mergedContactId: string }
  | { kind: 'repointed'; contactId: string }
  | { kind: 'author_missing' };

export async function linkRecipientIdentity(ctx: TenantCtx, input: LinkRecipientInput): Promise<LinkRecipientResult> {
  const { tx, tenantId } = ctx;
  const author = await tx.commentAuthor.findFirst({
    where: { id: input.commentAuthorId, tenantId },
    select: { id: true, contactId: true, createdContact: true, displayName: true, username: true },
  });
  if (!author) return { kind: 'author_missing' };

  if (input.commenterId && input.commenterId !== input.recipientUid) {
    // FB 的 feed from.id 不保證等於 PSID（M1）；IG 文件說兩者相同，不同時記下來以便實測回填
    logger.warn('[comment-reply] 留言者 ID 與 recipient_id 不同，以 recipient_id 建立渠道身分', {
      tenantId,
      channelId: input.channel.id,
      commentAuthorId: author.id,
      idMismatch: true,
    });
  }

  const profileName = author.displayName ?? (author.username ? `@${author.username}` : null);
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO channel_identities (id, "contactId", "channelId", "channelType", uid, "profileName")
    VALUES (gen_random_uuid(), ${author.contactId}::uuid, ${input.channel.id}::uuid,
            ${input.channel.channelType}::"ChannelType", ${input.recipientUid}, ${profileName})
    ON CONFLICT ("channelId", uid) DO NOTHING
    RETURNING id`;
  if (inserted.length > 0) {
    await setAuthorPsid(ctx, author.id, input.channel.id, input.recipientUid, author.contactId);
    return { kind: 'created', contactId: author.contactId };
  }

  const identity = await tx.channelIdentity.findFirst({
    where: { channelId: input.channel.id, uid: input.recipientUid, contact: { tenantId } },
    select: { contactId: true },
  });
  if (!identity) throw new Error('channel identity vanished after conflict');
  if (identity.contactId === author.contactId) {
    await setAuthorPsid(ctx, author.id, input.channel.id, input.recipientUid, author.contactId);
    return { kind: 'existing', contactId: author.contactId };
  }

  const authorContact = await tx.contact.findFirst({
    where: { id: author.contactId, tenantId },
    select: { isArchived: true },
  });
  if (author.createdContact && authorContact && !authorContact.isArchived) {
    try {
      await mergeContacts(ctx, { survivorId: identity.contactId, mergedId: author.contactId, source: 'COMMENT_REPLY' });
      // 合併引擎搬 comment_authors 之前（tasks 8.4），這裡先把留言者對應改指存活者；已搬時這一步不改任何列
      await setAuthorPsid(ctx, author.id, input.channel.id, input.recipientUid, identity.contactId);
      return { kind: 'merged', contactId: identity.contactId, mergedContactId: author.contactId };
    } catch (err) {
      // 合併被拒（例如同一渠道的身分衝突）是業務規則，不是資料庫錯誤，交易仍可繼續：退回只改指留言者對應
      if (!(err instanceof AppError)) throw err;
      logger.warn('[comment-reply] 留言者聯絡人無法自動合併，改為只改指留言者對應', {
        tenantId,
        commentAuthorId: author.id,
        code: err.code,
      });
    }
  } else {
    logger.warn('[comment-reply] recipient_id 已屬於另一位聯絡人，不自動合併原本就存在的聯絡人', {
      tenantId,
      commentAuthorId: author.id,
    });
  }
  await setAuthorPsid(ctx, author.id, input.channel.id, input.recipientUid, identity.contactId);
  return { kind: 'repointed', contactId: identity.contactId };
}

/** 寫 psid 並（必要時）改指聯絡人；同一渠道已有別的留言者用這個 psid 時不寫 psid（部分唯一索引） */
async function setAuthorPsid(ctx: TenantCtx, authorId: string, channelId: string, psid: string, contactId: string): Promise<void> {
  const taken = await ctx.tx.commentAuthor.findFirst({
    where: { tenantId: ctx.tenantId, channelId, psid, id: { not: authorId } },
    select: { id: true },
  });
  await ctx.tx.commentAuthor.updateMany({
    where: { id: authorId, tenantId: ctx.tenantId },
    data: { contactId, ...(taken ? {} : { psid }) },
  });
}
