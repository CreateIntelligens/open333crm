/**
 * KB Article Feedback service — AI 回答品質回饋迴路。
 *
 * 測試者/用戶在 LINE 點「👎 沒幫到我」→ 記下「問句 + 命中的 KB 文章」→
 * 後台知識庫頁顯示被回報次數，客服據此調教 KB content。
 */

import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';

export interface RecordFeedbackInput {
  rating: 'bad' | 'good';
  articleId: string; // 'none' 代表當時沒命中 KB
  messageId: string; // bot 那則回覆的 message id
  contactId?: string;
}

/**
 * 記錄一筆回報。會從 messageId 反查 bot 回覆 + 往前抓最近一則 inbound 當問句。
 */
export async function recordKbFeedback(
  prisma: TenantDb,
  tenantId: string,
  input: RecordFeedbackInput,
): Promise<void> {
  if (input.articleId === 'none') {
    logger.info('[KbFeedback] skipped: no KB article hit (articleId=none)');
    return;
  }

  // 反查 bot 訊息（拿 conversation + metadata confidence + 回答快照）。
  // 透過 conversation.tenantId 限定租戶，避免跨租戶讀到他人對話內容。
  const botMsg = await prisma.message.findFirst({
    where: { id: input.messageId, conversation: { tenantId } },
    select: {
      conversationId: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  let userQuestion: string | null = null;
  let botReply: string | null = null;
  let confidence: number | null = null;

  if (botMsg) {
    botReply = ((botMsg.content as Record<string, unknown>)?.text as string) ?? null;
    confidence = ((botMsg.metadata as Record<string, unknown>)?.confidence as number) ?? null;

    // 往前抓最近一則 inbound（使用者問句）
    const inbound = await prisma.message.findFirst({
      where: {
        conversationId: botMsg.conversationId,
        direction: 'INBOUND',
        createdAt: { lt: botMsg.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    userQuestion = ((inbound?.content as Record<string, unknown>)?.text as string) ?? null;
  }

  // 確認 article 屬於此 tenant（避免跨租戶汙染）
  const article = await prisma.kmArticle.findFirst({
    where: { id: input.articleId, tenantId },
    select: { id: true },
  });
  if (!article) {
    logger.warn(`[KbFeedback] article ${input.articleId} not found for tenant ${tenantId}, skip`);
    return;
  }

  await prisma.kbArticleFeedback.create({
    data: {
      tenantId,
      articleId: input.articleId,
      messageId: input.messageId,
      userQuestion,
      botReply,
      confidence,
      rating: input.rating,
      contactId: input.contactId ?? null,
      status: 'open',
    },
  });

  logger.info(
    `[KbFeedback] recorded ${input.rating} for article=${input.articleId} q="${userQuestion?.slice(0, 30) ?? '?'}"`,
  );
}

/**
 * 列出回報（後台用）。可依 articleId / status 過濾。
 */
export async function listFeedback(
  prisma: TenantDb,
  tenantId: string,
  filter: { articleId?: string; status?: string } = {},
) {
  return prisma.kbArticleFeedback.findMany({
    where: {
      tenantId,
      ...(filter.articleId ? { articleId: filter.articleId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      article: { select: { id: true, title: true, externalDocId: true } },
    },
  });
}

/**
 * 各文章的 open 回報數 map（給知識庫列表頁顯示 badge）。
 * 回傳 { [articleId]: openCount }
 */
export async function getFeedbackCounts(
  prisma: TenantDb,
  tenantId: string,
): Promise<Record<string, number>> {
  // groupBy 的多載在 TenantDb 聯集型別下無法解析（TS 限制），此處縮回 PrismaClient
  // 供型別檢查用；執行期 TenantScopedClient 仍會走 RLS 注入，行為不變。
  const rows = await (prisma as PrismaClient).kbArticleFeedback.groupBy({
    by: ['articleId'],
    where: { tenantId, status: 'open' },
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) {
    map[r.articleId] = r._count._all;
  }
  return map;
}

/**
 * 標記回報為已處理。
 */
export async function resolveFeedback(
  prisma: TenantDb,
  id: string,
  tenantId: string,
): Promise<void> {
  const existing = await prisma.kbArticleFeedback.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw new AppError('回報記錄不存在', 'NOT_FOUND', 404);
  }
  await prisma.kbArticleFeedback.update({
    where: { id },
    data: { status: 'resolved' },
  });
}
