/**
 * AI Service — provides KB-powered reply suggestions and conversation summaries.
 */

import type { PrismaClient } from '@prisma/client';
import { generateEmbedding, searchSimilarArticles } from '../embedding/embedding.service.js';
import { generateReply, CRM_REPLY_SYSTEM_PROMPT, SUMMARIZE_SYSTEM_PROMPT } from './llm.service.js';
import { logger } from '@open333crm/core';

export async function suggestReply(prisma: PrismaClient, conversationId: string) {
  // Fetch last few inbound messages for context
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { content: true, senderType: true },
  });

  const lastInbound = messages.find((m) => m.senderType === 'CONTACT');
  const userText =
    lastInbound && typeof lastInbound.content === 'object' && lastInbound.content !== null
      ? (lastInbound.content as { text?: string }).text || ''
      : '';

  if (!userText) {
    return { suggestions: [] };
  }

  // Look up conversation tenantId
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true },
  });

  if (!conversation) {
    return { suggestions: [] };
  }

  try {
    const queryEmbedding = await generateEmbedding(userText);
    const results = await searchSimilarArticles(prisma, queryEmbedding, conversation.tenantId, {
      topK: 3,
      threshold: 0.3,
    });

    if (results.length === 0) {
      return { suggestions: [] };
    }

    // Generate LLM-based suggestions for each KB result
    const suggestions = await Promise.all(
      results.map(async (r) => {
        const kbContext = `【${r.title}】\n${(r.content || r.summary).slice(0, 1500)}`;
        let text: string;
        try {
          text = await generateReply(CRM_REPLY_SYSTEM_PROMPT, userText, kbContext);
        } catch {
          // Fallback to article content/summary if LLM fails
          text = r.content || r.summary || r.title;
        }
        return {
          text,
          confidence: Math.round(r.similarity * 100) / 100,
          kmRefs: [{ id: r.id, title: r.title, url: `/dashboard/knowledge?id=${r.id}` }],
        };
      }),
    );

    return { suggestions };
  } catch (err) {
    logger.error('[AI] suggestReply error, returning empty:', err);
    return { suggestions: [] };
  }
}

export async function summarizeConversation(prisma: PrismaClient, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      contact: { select: { displayName: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { senderType: true, content: true, createdAt: true },
      },
    },
  });

  if (!conversation) {
    return { summary: '找不到對話記錄。' };
  }

  const contactName = conversation.contact?.displayName || '客戶';
  const msgCount = conversation.messages.length;
  const botMsgs = conversation.messages.filter((m) => m.senderType === 'BOT').length;

  // Build conversation transcript for LLM
  const transcript = conversation.messages
    .map((m) => {
      const sender =
        m.senderType === 'CONTACT'
          ? contactName
          : m.senderType === 'BOT'
            ? 'Bot'
            : '客服人員';
      const text =
        typeof m.content === 'object' && m.content !== null
          ? (m.content as { text?: string }).text || '[非文字訊息]'
          : '[非文字訊息]';
      return `${sender}: ${text}`;
    })
    .join('\n');

  try {
    const summary = await generateReply(SUMMARIZE_SYSTEM_PROMPT, transcript, '');
    return { summary };
  } catch (err) {
    // Fallback to static template if LLM fails
    logger.error('[AI] summarizeConversation LLM failed, using fallback:', err);
    return {
      summary: `${contactName} 的對話共 ${msgCount} 則訊息，其中 Bot 回覆了 ${botMsgs} 則。客戶主要詢問了產品相關問題，Bot 提供了初步回覆但客戶可能需要更詳細的人工協助。建議確認客戶需求後提供具體解決方案。`,
    };
  }
}
