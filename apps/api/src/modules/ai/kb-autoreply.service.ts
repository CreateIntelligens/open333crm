/**
 * KB Auto-Reply Service
 *
 * When an inbound message arrives in a BOT_HANDLED conversation, decide what
 * to do based on KB similarity tiers:
 *   >= 0.80               — direct LLM reply grounded in KB
 *   threshold–0.80        — LLM reply grounded in KB + handoff prompt appended
 *   < threshold (or no KB)— **clarify**: ask one question to gather more info,
 *                           bounded by clarifyMaxAttempts (then handoff)
 *
 * The LLM now receives the recent conversation history (last 10 messages) so
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
import { deliverToChannel } from '../conversation/conversation.service.js';
import {
  hasMatchingKeywordRule,
  DEFAULT_BOT_CONFIG,
  DEFAULT_HANDOFF_PROMPT_TEXT,
  type BotConfig,
} from '../automation/automation.worker.js';
import { logger } from '@open333crm/core';

const CLARIFY_HANDOFF_FALLBACK =
  '不好意思我這邊還沒辦法判斷您的需求，已為您轉接客服人員，請稍候。';
const HISTORY_LIMIT = 10;

type ReplyKind = 'kb_high_confidence' | 'kb_with_handoff' | 'clarify' | 'clarify_handoff';

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

  // 1.5 若有 keyword.matched 規則命中此訊息，讓步給 keyword 規則處理。
  // 避免 KB 走 clarify_handoff 把對話改成 AGENT_HANDLED，後續 keyword rule 觸發後也無法回。
  if (await hasMatchingKeywordRule(prisma, tenantId, messageText)) {
    logger.info(`[KbAutoReply] conv=${conversationId} skipped: keyword rule will handle`);
    return false;
  }

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

  // 3. Channel botMode gating + 解析完整 botConfig（含 handoff prompt 設定）
  const channelSettings = (conversation.channel.settings || {}) as Record<string, unknown>;
  const rawBotConfig = (channelSettings.botConfig || {}) as Partial<BotConfig>;
  const botConfig: BotConfig = { ...DEFAULT_BOT_CONFIG, ...rawBotConfig };
  if (botConfig.botMode === 'off' || botConfig.botMode === 'keyword') return false;

  // 4. Load tenant chat settings (clarify thresholds + system prompts)
  const chatSettings = await getChatSettings(prisma, tenantId);

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

    try {
      const llmReply = await generateReply(prisma, tenantId, messageText, kbContext, { history });
      replyText = llmReply;
      replyKind = topSimilarity >= 0.80 ? 'kb_high_confidence' : 'kb_with_handoff';
      // Successful KB answer resets clarify attempts
      metadataExtras = { clarifyAttempts: 0 };
    } catch (err) {
      logger.error('[KbAutoReply] LLM generation failed, falling back to article content:', err);
      replyText = topResult.content || topResult.summary || topResult.title;
      replyKind = topSimilarity >= 0.80 ? 'kb_high_confidence' : 'kb_with_handoff';
      metadataExtras = { clarifyAttempts: 0 };
    }
  }

  // 8b. 決定要不要附 handoff prompt（只在 kb_with_handoff，kb_high_confidence 不附）
  const kbReply = buildKbReplyPayload({
    replyText,
    replyKind,
    botConfig,
    articleId: topResult?.id,
    botMessageId: null, // 先佔位，存完 message 後再補
  });
  // 真正送 channel 的文字（可能多帶 text suffix）— DB 也存這份以利客服 UI 對齊
  const finalText = kbReply.text;

  // 9. Persist BOT message
  const now = new Date();
  const botMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: finalText },
      metadata: {
        source: 'kb_auto_reply',
        replyKind,
        confidence: topSimilarity,
        articleId: topResult?.id,
        articleTitle: topResult?.title,
        allResults: results.map((r) => ({ id: r.id, title: r.title, similarity: r.similarity })),
      },
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
      content: { text: finalText },
      metadata: botMessage.metadata,
      createdAt: now.toISOString(),
      sender: null,
    },
  };
  io.to(`conversation:${conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

  // 12. Deliver to actual channel
  // 命中 KB 的回答附「👎 沒幫到我」回報按鈕（quick reply postback），供調教 KB。
  // 加上 handoff_request 按鈕（依 botConfig.handoffPromptStyle）給使用者一鍵轉接。
  // clarify / clarify_handoff 那種沒命中 KB 的不附（沒對應文章可回報、也不附轉接按鈕）。
  const hitKb = replyKind === 'kb_high_confidence' || replyKind === 'kb_with_handoff';
  const quickReplies: Array<{ label: string; postbackData: string }> = [];
  if (hitKb && topResult?.id) {
    quickReplies.push({
      label: '👎 沒幫到我',
      postbackData: `kb_feedback:bad:${topResult.id}:${botMessage.id}`,
    });
  }
  if (kbReply.includeHandoffButton) {
    quickReplies.push({
      label: botConfig.handoffButtonLabel,
      postbackData: 'handoff_request',
    });
  }

  if (quickReplies.length > 0) {
    await deliverToChannel(prisma, conversationId, {
      contentType: 'text',
      content: { text: finalText, quickReplies },
    });
  } else {
    await deliverToChannel(prisma, conversationId, finalText);
  }

  logger.info(
    `[KbAutoReply] conv=${conversationId} kind=${replyKind} sim=${topSimilarity.toFixed(3)} handoffStyle=${botConfig.handoffPromptEnabled ? botConfig.handoffPromptStyle : 'disabled'}`,
  );

  return true;
}

/**
 * 依 botConfig.handoffPromptEnabled / handoffPromptStyle 決定 KB 回答要不要附
 * handoff 提示（文字 suffix 或 quick reply 按鈕）。
 *
 * - kb_high_confidence：不附（無論 botConfig 設定如何，高信心回答本身已足夠）
 * - kb_with_handoff + enabled=true：依 style 決定（text / button / both / none）
 * - enabled=false：完全不附
 */
function buildKbReplyPayload(input: {
  replyText: string;
  replyKind: ReplyKind;
  botConfig: BotConfig;
  articleId: string | undefined;
  botMessageId: string | null;
}): { text: string; includeHandoffButton: boolean } {
  const { replyText, replyKind, botConfig } = input;

  if (replyKind !== 'kb_with_handoff') {
    return { text: replyText, includeHandoffButton: false };
  }
  if (!botConfig.handoffPromptEnabled) {
    return { text: replyText, includeHandoffButton: false };
  }

  const style = botConfig.handoffPromptStyle;
  const wantsText = style === 'text' || style === 'both';
  const wantsButton = style === 'button' || style === 'both';
  const text = wantsText
    ? `${replyText}\n\n${DEFAULT_HANDOFF_PROMPT_TEXT}`
    : replyText;
  return { text, includeHandoffButton: wantsButton };
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
