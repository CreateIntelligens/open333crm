/**
 * 留言自動私訊 4 張表的測試資料（change add-comment-keyword-private-reply，補 comment-reply-fixtures.ts 的 TODO）。
 *
 * 與 createCommentReplyFixtures() 搭配：fixtures 建租戶、渠道、角色、成員；這裡建規則、留言者（含聯絡人）、紀錄、用量。
 * 寫入用呼叫端給的 client（owner 連線，繞過 RLS）。cleanup 依外鍵順序刪除：紀錄 → 留言者 → 聯絡人 → 規則 → 用量，
 * 交給 fixtures.cleanup(extra) 的 extra 呼叫。
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export function createCommentReplyRecords(prisma: PrismaClient) {
  let seq = 0;
  const next = () => `${Date.now().toString(36)}${++seq}`;

  async function rule(
    tenantId: string,
    channelId: string,
    data: Partial<Prisma.CommentReplyRuleUncheckedCreateInput> = {},
  ) {
    return prisma.commentReplyRule.create({
      data: {
        tenantId,
        channelId,
        name: `規則 ${next()}`,
        keywords: ['+1'],
        contentType: 'text',
        messageText: '感謝留言',
        ...data,
      },
    });
  }

  /** 留言者與其聯絡人 */
  async function author(tenantId: string, channelId: string, data: Partial<Prisma.CommentAuthorUncheckedCreateInput> = {}) {
    const contact = await prisma.contact.create({ data: { tenantId, displayName: `留言者 ${next()}` } });
    return prisma.commentAuthor.create({
      data: {
        tenantId,
        channelId,
        externalUserId: `U-${next()}`,
        contactId: contact.id,
        firstCommentAt: new Date(),
        lastCommentAt: new Date(),
        ...data,
      },
    });
  }

  async function log(
    tenantId: string,
    channelId: string,
    ruleId: string,
    commentAuthorId: string,
    data: Partial<Prisma.CommentReplyLogUncheckedCreateInput> = {},
  ) {
    return prisma.commentReplyLog.create({
      data: {
        tenantId,
        channelId,
        ruleId,
        commentAuthorId,
        commentId: `C-${next()}-${randomUUID().slice(0, 6)}`,
        postId: 'P_1',
        commentCreatedAt: new Date(),
        commenterId: 'U-1',
        commenterName: '王小明',
        commentText: '+1 我要',
        matchedKeywords: ['+1'],
        ...data,
      },
    });
  }

  async function cleanup(tenantIds: string[]) {
    if (!tenantIds.length) return;
    const where = { tenantId: { in: tenantIds } };
    await prisma.conversation.updateMany({ where, data: { originCommentReplyLogId: null } });
    await prisma.commentReplyLog.deleteMany({ where });
    await prisma.commentAuthor.deleteMany({ where });
    await prisma.commentReplyRule.deleteMany({ where });
    await prisma.commentReplyUsage.deleteMany({ where });
    await prisma.material.deleteMany({ where });
    await prisma.tenantAuditLog.deleteMany({ where });
    await prisma.outbox.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
  }

  return { rule, author, log, cleanup };
}
