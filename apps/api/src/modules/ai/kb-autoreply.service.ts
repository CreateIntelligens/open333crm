/**
 * KB Auto-Reply Service
 *
 * When an inbound message arrives in a BOT_HANDLED conversation, decide what
 * to do based on KB similarity tiers:
 *   >= 0.80               — direct LLM reply grounded in KB
 *   threshold–0.80        — LLM reply grounded in KB
 *   < threshold (or no KB)— **clarify**: ask one question to gather more info,
 *                           bounded by clarifyMaxAttempts (then handoff)
 *
 * The HANDOFF_PROMPT (「需要真人客服協助嗎？...」) is now appended ONLY when
 * the inbound user message is detected as negative sentiment (per tenant
 * settings: handoffOnNegativeSentiment + negativeSentimentThreshold). KB
 * similarity tiers no longer drive that decision.
 *
 * The LLM receives the recent conversation history (last 10 messages) so
 * follow-up turns make sense and clarification questions don't repeat earlier
 * answers.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import { getConfig } from '../../config/env.js';
import { generateEmbedding, searchSimilarArticles } from '../embedding/embedding.service.js';
import { getEmbeddingSettings } from '../settings/embedding-settings.service.js';
import { getChatSettings } from '../settings/chat-settings.service.js';
import { generateReply, CLARIFY_SYSTEM_PROMPT } from './llm.service.js';
import type { HistoryMessage } from './llm.service.js';
import { analyzeSentiment } from './sentiment.service.js';
import type { SentimentResult } from './sentiment.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { eventBus } from '../../events/event-bus.js';
import { logger } from '@open333crm/core';

const HANDOFF_PROMPT = '需要真人客服協助嗎？請輸入「真人」或「客服」即可轉接。';
const CLARIFY_HANDOFF_FALLBACK =
  '不好意思我這邊還沒辦法判斷您的需求，已為您轉接客服人員，請稍候。';
const HISTORY_LIMIT = 10;

type ReplyKind =
  | 'kb_high_confidence'
  | 'kb_mid_confidence'
  | 'kb_with_handoff'
  | 'clarify'
  | 'clarify_handoff';

export async function attemptKbAutoReply(
  prisma: PrismaClient,
  io: Server,
  tenantId: string,
  conversationId: string,
  messageText: string,
): Promise<boolean> {
  const config = getConfig();

  // 1. Global enable check
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

  // 3. Channel botMode gating
  const channelSettings = (conversation.channel.settings || {}) as Record<string, unknown>;
  const botMode = channelSettings.botMode as string | undefined;
  if (botMode === 'off' || botMode === 'keyword') return false;

  // 4. Load tenant chat settings (clarify thresholds + system prompts)
  const chatSettings = await getChatSettings(prisma, tenantId);

  // 4.5 Sentiment analysis on the inbound user message — drives whether we
  // append HANDOFF_PROMPT to the reply.
  let userSentiment: SentimentResult | null = null;
  if (chatSettings.handoffOnNegativeSentiment) {
    try {
      userSentiment = await analyzeSentiment(prisma, tenantId, messageText);
      logger.info(
        `[KbAutoReply] sentiment=${userSentiment.sentiment} score=${userSentiment.score} confidence=${userSentiment.confidence}`,
      );
    } catch (err) {
      logger.error('[KbAutoReply] sentiment analysis failed:', err);
    }
  }
  const isNegative =
    !!userSentiment &&
    userSentiment.sentiment === 'negative' &&
    userSentiment.confidence >= chatSettings.negativeSentimentThreshold;

  // 4.6 Sentiment-driven handoff: if the user is clearly upset AND the tenant
  // opted in, transition the conversation to AGENT_HANDLED and publish a
  // handoff event so assignment rules / fallback can route it to a human.
  // We then return false (no BOT reply) — the human will take over.
  if (isNegative && chatSettings.sentimentTriggersHandoff) {
    const reason = '客戶情緒負面，自動轉接';
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'AGENT_HANDLED', handoffReason: reason },
    });
    eventBus.publish({
      name: 'conversation.handoff',
      tenantId,
      timestamp: new Date(),
      payload: { conversationId, reason, summary: '', previousStatus: 'BOT_HANDLED' },
    });
    io.to(`conversation:${conversationId}`).emit('conversation.updated', {
      id: conversationId,
      status: 'AGENT_HANDLED',
      handoffReason: reason,
    });
    io.to(`tenant:${tenantId}`).emit('conversation.updated', {
      id: conversationId,
      status: 'AGENT_HANDLED',
      handoffReason: reason,
    });
    logger.info(`[KbAutoReply] Sentiment-driven handoff: conv=${conversationId}`);
    return false;
  }

  // 5. Fetch conversation history (excluding the just-arrived message we're replying to)
  const history = await loadHistory(prisma, conversationId);

  // 6. Generate embedding for inbound message
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(prisma, tenantId, messageText);
  } catch (err) {
    logger.error('[KbAutoReply] Failed to generate embedding:', err);
    return false;
  }

  // 7. KB similarity search
  const embeddingSettings = await getEmbeddingSettings(prisma, tenantId);
  const results = await searchSimilarArticles(prisma, queryEmbedding, tenantId, {
    topK: embeddingSettings.topK,
    threshold: embeddingSettings.threshold,
  });
  const topResult = results[0];
  const topSimilarity = topResult?.similarity ?? 0;
  logger.info(
    `[KbAutoReply] conv=${conversationId} kbResults=${results.length} topSim=${topSimilarity.toFixed(3)}`,
  );

  // 8. Decide reply path
  const needsClarify = !topResult || topSimilarity < chatSettings.clarifyThreshold;
  let replyText: string;
  let replyKind: ReplyKind;
  let metadataExtras: Record<string, unknown> = {};

  if (needsClarify) {
    // Track clarify attempts in conversation.metadata to avoid loops
    const convMeta = (conversation.metadata ?? {}) as Record<string, unknown>;
    const prevAttempts = Number(convMeta.clarifyAttempts ?? 0);
    const nextAttempts = prevAttempts + 1;

    if (prevAttempts >= chatSettings.clarifyMaxAttempts) {
      replyText = CLARIFY_HANDOFF_FALLBACK;
      replyKind = 'clarify_handoff';
      metadataExtras = { clarifyAttempts: prevAttempts };
    } else {
      try {
        const overridePrompt =
          chatSettings.clarifySystemPrompt || CLARIFY_SYSTEM_PROMPT;
        const llmReply = await generateReply(prisma, tenantId, messageText, '', {
          overrideSystemPrompt: overridePrompt,
          history,
        });
        replyText = llmReply;
        replyKind = 'clarify';
        metadataExtras = { clarifyAttempts: nextAttempts };
      } catch (err) {
        logger.error('[KbAutoReply] Clarify generation failed, handing off:', err);
        replyText = CLARIFY_HANDOFF_FALLBACK;
        replyKind = 'clarify_handoff';
        metadataExtras = { clarifyAttempts: prevAttempts };
      }
    }
  } else {
    // KB has a useful match — use it as grounded context
    const kbContext = results
      .map((r, i) => `【文章${i + 1}】${r.title}\n${(r.content || r.summary).slice(0, 1500)}`)
      .join('\n\n');

    // Sentiment-aware handoff: only append HANDOFF_PROMPT when the user
    // message is detected as negative (per tenant settings). KB confidence
    // tier no longer drives the append decision.
    const baseKind: ReplyKind = topSimilarity >= 0.80 ? 'kb_high_confidence' : 'kb_mid_confidence';
    try {
      const llmReply = await generateReply(prisma, tenantId, messageText, kbContext, { history });
      if (isNegative) {
        replyText = `${llmReply}\n\n${HANDOFF_PROMPT}`;
        replyKind = 'kb_with_handoff';
      } else {
        replyText = llmReply;
        replyKind = baseKind;
      }
      // Successful KB answer resets clarify attempts
      metadataExtras = { clarifyAttempts: 0 };
    } catch (err) {
      logger.error('[KbAutoReply] LLM generation failed, falling back to article content:', err);
      const fallbackText = topResult.content || topResult.summary || topResult.title;
      if (isNegative) {
        replyText = `${fallbackText}\n\n${HANDOFF_PROMPT}`;
        replyKind = 'kb_with_handoff';
      } else {
        replyText = fallbackText;
        replyKind = baseKind;
      }
      metadataExtras = { clarifyAttempts: 0 };
    }
  }

  // 9. Persist BOT message
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
        replyKind,
        confidence: topSimilarity,
        articleId: topResult?.id,
        articleTitle: topResult?.title,
        allResults: results.map((r) => ({ id: r.id, title: r.title, similarity: r.similarity })),
        userSentiment: userSentiment ?? null,
      } as Prisma.InputJsonValue,
      createdAt: now,
    },
  });

  // 10. Update conversation (counters + clarifyAttempts)
  const existingMeta = (conversation.metadata ?? {}) as Record<string, unknown>;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      botRepliesCount: { increment: 1 },
      lastMessageAt: now,
      metadata: { ...existingMeta, ...metadataExtras } as Prisma.InputJsonValue,
    },
  });

  // 11. Real-time
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

  // 12. Deliver to actual channel
  await deliverToChannel(prisma, conversationId, replyText);

  logger.info(
    `[KbAutoReply] conv=${conversationId} kind=${replyKind} sim=${topSimilarity.toFixed(3)}`,
  );

  return true;
}

/**
 * Fetch the last HISTORY_LIMIT messages of the conversation as
 * user/assistant turns. The just-arrived inbound message is excluded — we
 * pass it separately via `userMessage`.
 */
async function loadHistory(
  prisma: PrismaClient,
  conversationId: string,
): Promise<HistoryMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT + 1,
    select: { direction: true, senderType: true, content: true },
  });
  // Drop the most recent inbound (the one we're replying to right now).
  const trimmed = rows.length > 0 && rows[0].direction === 'INBOUND' ? rows.slice(1) : rows;

  return trimmed
    .reverse()
    .map((m) => {
      const text =
        typeof m.content === 'object' && m.content !== null
          ? ((m.content as { text?: string }).text ?? '')
          : '';
      if (!text) return null;
      const role: 'user' | 'assistant' = m.direction === 'INBOUND' ? 'user' : 'assistant';
      return { role, content: text };
    })
    .filter((m): m is HistoryMessage => m !== null);
}
