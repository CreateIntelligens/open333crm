/**
 * AI Service — 建議回覆與對話摘要讀的資料（change migrate-ai-llm-tenant-ctx，design D7）。
 * 呼叫 LLM 與搜尋知識庫的順序在 ai.flow.ts。
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { readModelMessageContent } from './deidentification.service.js';

/** 建議回覆的查詢文字：最近 5 則訊息中最新的顧客訊息。沒有可用的文字或找不到對話時回 null */
export async function readSuggestReplyQuery(ctx: TenantCtx, conversationId: string): Promise<string | null> {
  const messages = await ctx.tx.message.findMany({
    where: { conversationId, conversation: { tenantId: ctx.tenantId } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { content: true, metadata: true, senderType: true },
  });

  const lastInbound = messages.find((m) => m.senderType === 'CONTACT');
  const userText = lastInbound ? readModelMessageContent(lastInbound.content, lastInbound.metadata) : '';
  if (!userText) return null;

  const conversation = await ctx.tx.conversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  return conversation ? userText : null;
}

export interface ConversationTranscript {
  contactName: string;
  msgCount: number;
  botMsgs: number;
  /** 送給 LLM 的逐字稿 */
  transcript: string;
}

/** 對話的前 20 則訊息組成逐字稿。找不到對話時回 null */
export async function readConversationTranscript(
  ctx: TenantCtx,
  conversationId: string,
): Promise<ConversationTranscript | null> {
  const conversation = await ctx.tx.conversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    include: {
      contact: { select: { displayName: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { senderType: true, content: true, metadata: true, createdAt: true },
      },
    },
  });
  if (!conversation) return null;

  const contactName = conversation.contact?.displayName || '客戶';
  const transcript = conversation.messages
    .map((m) => {
      const sender =
        m.senderType === 'CONTACT'
          ? contactName
          : m.senderType === 'BOT'
            ? 'Bot'
            : '客服人員';
      const text = readModelMessageContent(m.content, m.metadata) || '[非文字訊息]';
      return `${sender}: ${text}`;
    })
    .join('\n');

  return {
    contactName,
    msgCount: conversation.messages.length,
    botMsgs: conversation.messages.filter((m) => m.senderType === 'BOT').length,
    transcript,
  };
}

/** LLM 失敗時的固定格式摘要 */
export function fallbackSummary(t: ConversationTranscript): string {
  return `${t.contactName} 的對話共 ${t.msgCount} 則訊息，其中 Bot 回覆了 ${t.botMsgs} 則。客戶主要詢問了產品相關問題，Bot 提供了初步回覆但客戶可能需要更詳細的人工協助。建議確認客戶需求後提供具體解決方案。`;
}
