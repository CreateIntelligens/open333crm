/**
 * KB Auto-Reply Service
 *
 * When an inbound message arrives in a BOT_HANDLED conversation,
 * searches the knowledge base for similar articles and automatically
 * replies based on confidence tiers:
 *   >= 0.80  — direct reply with article summary
 *   0.50–0.80 — reply + human-handoff prompt
 *   < 0.50  — no reply (let automation or agent handle it)
 */

import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { getConfig } from '../../config/env.js';
import { generateEmbedding, searchSimilarArticles } from '../embedding/embedding.service.js';
import { generateReply, CRM_REPLY_SYSTEM_PROMPT } from './llm.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';

const HANDOFF_PROMPT = '需要真人客服協助嗎？請輸入「真人」或「客服」即可轉接。';

export async function attemptKbAutoReply(
  prisma: PrismaClient,
  io: Server,
  tenantId: string,
  conversationId: string,
  messageText: string,
): Promise<boolean> {
  const config = getConfig();

  // 1. Check if KB auto-reply is enabled
  if (!config.KB_AUTO_REPLY_ENABLED) return false;

  // 2. Only proceed for BOT_HANDLED conversations
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
    include: {
      channel: { select: { id: true, channelType: true, credentialsEncrypted: true, settings: true, isActive: true } },
      contact: {
        select: {
          channelIdentities: {
            select: { uid: true, channelId: true },
          },
        },
      },
    },
  });

  if (!conversation) return false;

  // 3. Check channel botMode setting
  const settings = (conversation.channel.settings || {}) as Record<string, unknown>;
  const botMode = settings.botMode as string | undefined;
  if (botMode === 'off' || botMode === 'keyword') return false;

  // 4. Generate embedding for inbound message
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(messageText);
  } catch (err) {
    console.error('[KbAutoReply] Failed to generate embedding:', err);
    return false;
  }

  // 5. Search KB for similar articles
  const results = await searchSimilarArticles(prisma, queryEmbedding, tenantId, {
    topK: 3,
    threshold: 0.3,
  });
  if (results.length === 0) return false;

  const topResult = results[0];

  // 6. Build KB context from top results (truncate to avoid LLM timeout)
  const kbContext = results
    .map((r, i) => `【文章${i + 1}】${r.title}\n${(r.content || r.summary).slice(0, 1500)}`)
    .join('\n\n');

  let replyText: string;
  try {
    const llmReply = await generateReply(CRM_REPLY_SYSTEM_PROMPT, messageText, kbContext);
    if (topResult.similarity >= 0.80) {
      replyText = llmReply;
    } else {
      // 0.50–0.80 range: append handoff prompt
      replyText = `${llmReply}\n\n${HANDOFF_PROMPT}`;
    }
  } catch (err) {
    // Fallback: use article content/summary directly if LLM fails
    console.error('[KbAutoReply] LLM generation failed, falling back to article content:', err);
    const fallbackText = topResult.content || topResult.summary || topResult.title;
    if (topResult.similarity >= 0.80) {
      replyText = fallbackText;
    } else {
      replyText = `${fallbackText}\n\n${HANDOFF_PROMPT}`;
    }
  }

  // 7. Create BOT message
  const now = new Date();
  const botMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: replyText },
      metadata: {
        source: 'kb_auto_reply',
        confidence: topResult.similarity,
        articleId: topResult.id,
        articleTitle: topResult.title,
        allResults: results.map((r) => ({
          id: r.id,
          title: r.title,
          similarity: r.similarity,
        })),
      },
      createdAt: now,
    },
  });

  // 8. Update conversation
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      botRepliesCount: { increment: 1 },
      lastMessageAt: now,
    },
  });

  // 9. Emit WebSocket events
  const wsPayload = {
    conversationId,
    message: {
      id: botMessage.id,
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: replyText },
      metadata: botMessage.metadata,
      createdAt: now.toISOString(),
      sender: null,
    },
  };
  io.to(`conversation:${conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

  // 10. Deliver reply to actual channel via plugin
  await deliverToChannel(prisma, conversationId, replyText);

  console.log(
    `[KbAutoReply] Replied to conversation ${conversationId} (confidence: ${topResult.similarity.toFixed(3)}, article: ${topResult.title})`,
  );

  return true;
}
