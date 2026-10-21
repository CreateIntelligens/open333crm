/**
 * Automation event-bus worker.
 *
 * Subscribes to application events and enqueues automation rule evaluation.
 * Actual rule evaluation and action execution are handled by apps/workers.
 */

import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import { Queue } from 'bullmq';
import { eventBus } from '../../events/event-bus.js';
import type { AppEvent } from '../../events/event-bus.js';
import { createEventRouter, type EventHandler } from '../../events/subscriber-workers.js';
import { attemptKbAutoReply } from '../ai/kb-autoreply.service.js';
import { prepareStoredMessageContent } from '../ai/deidentification.service.js';
import { analyzeSentiment } from '../ai/sentiment.service.js';
import { autoClassifyNewCase } from '../ai/classify.service.js';
import { isAgentEnabled, runAgentReply } from '../ai/agent/agent.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { logger } from '@open333crm/core';
import {
  getBotConfig,
  hasMatchingKeywordRule,
  matchKeywordTrigger,
  shouldRunAgentReply,
  type BotConfig,
} from '@open333crm/automation';

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL，
// ioredis fallback default 6379 會噴一堆 ECONNREFUSED 噪音
let _automationQueue: Queue | null = null;
function automationQueue(): Queue {
  if (!_automationQueue) {
    _automationQueue = new Queue('automation', {
      connection: { url: process.env.REDIS_URL! },
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
    });
  }
  return _automationQueue;
}

async function getConversationBotConfig(
  prisma: PrismaClient,
  tenantId: string,
  conversationId: string,
): Promise<BotConfig | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
    include: { channel: { select: { settings: true } } },
  });
  return conversation ? getBotConfig(conversation.channel?.settings) : null;
}

async function checkAutoHandoff(
  prisma: PrismaClient,
  io: Server,
  tenantId: string,
  conversationId: string,
  messageContent?: string,
  contentType?: string,
) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
      include: { channel: { select: { settings: true } } },
    });

    if (!conversation) return;

    // Read bot config from channel settings
    const botConfig = getBotConfig(conversation.channel?.settings);

    let shouldHandoff = false;
    let reason = '';

    // Check 1: Bot replies count exceeded threshold
    if (conversation.botRepliesCount >= botConfig.maxBotReplies) {
      shouldHandoff = true;
      reason = `Bot 回覆次數已達上限 (${conversation.botRepliesCount}/${botConfig.maxBotReplies})`;
    }

    // Check 2: Keyword match for human agent request
    if (!shouldHandoff && messageContent && botConfig.handoffKeywords.length > 0) {
      const lowerContent = messageContent.toLowerCase();
      for (const keyword of botConfig.handoffKeywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          shouldHandoff = true;
          reason = `客戶要求轉接真人 (關鍵字: ${keyword})`;
          break;
        }
      }
    }

    // Check 3: Image/file message from customer (may need human handling)
    if (!shouldHandoff && contentType && ['image', 'file', 'video'].includes(contentType)) {
      shouldHandoff = true;
      reason = `客戶發送了${contentType === 'image' ? '圖片' : contentType === 'file' ? '檔案' : '影片'}，需要人工處理`;
    }

    if (shouldHandoff) {
      // Generate conversation summary before handoff
      let summary = '';
      try {
        const { summarizeConversation } = await import('../ai/ai.service.js');
        const summaryResult = await summarizeConversation(prisma, tenantId, conversationId);
        summary = summaryResult.summary;
      } catch (err) {
        logger.error('[AutoHandoff] Failed to generate summary:', err);
      }

      // Auto-handoff: change status to AGENT_HANDLED
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'AGENT_HANDLED',
          handoffReason: reason,
        },
      });

      // Send system message with summary
      const now = new Date();
      const systemText = summary
        ? `自動轉接人工客服：${reason}\n\n📋 Bot 對話摘要：\n${summary}`
        : `自動轉接人工客服：${reason}`;
      const storedContent = await prepareStoredMessageContent(prisma, tenantId, { text: systemText }, 'system');

      const systemMessage = await prisma.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: storedContent.content,
          metadata: { type: 'auto_handoff', reason, summary: summary || undefined, ...storedContent.metadata },
          isRead: true,
          createdAt: now,
        },
      });

      const updatedConversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });

      // Deliver configurable handoff message to channel
      await deliverToChannel(prisma, conversationId, botConfig.handoffMessage);

      // Publish conversation.handoff event
      eventBus.publish({
        name: 'conversation.handoff',
        tenantId,
        timestamp: now,
        payload: {
          conversationId,
          reason,
          summary,
          previousStatus: 'BOT_HANDLED',
        },
      });

      // Emit WebSocket events
      const wsPayload: ConversationUpdatedPayload = {
        id: updatedConversation.id,
        status: updatedConversation.status,
        assignedToId: updatedConversation.assignedToId,
        unreadCount: updatedConversation.unreadCount,
        lastMessageAt: updatedConversation.lastMessageAt?.toISOString() ?? null,
        updatedAt: updatedConversation.updatedAt.toISOString(),
        handoffReason: reason,
      };
      io.to(`conversation:${conversationId}`).emit('conversation.updated', wsPayload);
      io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

      io.to(`conversation:${conversationId}`).emit('message.new', {
        conversationId,
        message: {
          id: systemMessage.id,
          conversationId,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: systemMessage.content,
          createdAt: now.toISOString(),
          sender: null,
        },
      });

      logger.info(`[AutoHandoff] Conversation ${conversationId} auto-escalated: ${reason}`);
    }
  } catch (err) {
    logger.error('[AutoHandoff] Error:', err);
  }
}

/**
 * Check if a message matches keyword.matched rules and publish events.
 */
async function checkKeywordTriggers(
  prisma: PrismaClient,
  tenantId: string,
  messageText: string,
  payload: Record<string, unknown>,
) {
  try {
    // Find all active rules with trigger.type === 'keyword.matched'
    const allRules = await prisma.automationRule.findMany({
      where: { tenantId, isActive: true },
    });

    const keywordRules = allRules.filter((rule) => {
      const trigger = rule.trigger as Record<string, unknown>;
      return trigger?.type === 'keyword.matched';
    });

    if (keywordRules.length === 0) return;

    for (const rule of keywordRules) {
      const match = matchKeywordTrigger(rule.trigger, messageText);
      const matched = match !== null;
      const matchedKeywords = match?.matchedKeywords ?? [];
      const matchMode = match?.matchMode ?? 'any';

      if (matched) {
        logger.info(`[AutomationWorker] keyword.matched: rule="${rule.name}", keywords=[${matchedKeywords.join(', ')}]`);

        eventBus.publish({
          name: 'keyword.matched',
          tenantId,
          timestamp: new Date(),
          payload: {
            ...payload,
            matchedKeywords,
            matchMode,
            ruleId: rule.id,
          },
        });
      }
    }
  } catch (err) {
    logger.error('[AutomationWorker] Error checking keyword triggers:', err);
  }
}

export function setupAutomationWorker(prisma: PrismaClient, io: Server): EventHandler {
  const events = createEventRouter();

  // ── message.received ────────────────────────────────────────────────────
  events.on('message.received', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, messageId, messageContent, content, contentType, channelType, replyToken, receivedAt } = event.payload as {
        contactId?: string;
        conversationId?: string;
        messageId?: string;
        messageContent?: string;
        content?: { text?: string };
        contentType?: string;
        channelType?: string;
        replyToken?: string;
        receivedAt?: string;
      };

      // Extract message text from either direct messageContent or content.text
      const text = messageContent ?? content?.text ?? undefined;

      // Check auto-handoff for BOT_HANDLED conversations
      if (conversationId) {
        await checkAutoHandoff(prisma, io, event.tenantId, conversationId, text, contentType);
      }

      const botConfig = conversationId
        ? await getConversationBotConfig(prisma, event.tenantId, conversationId)
        : null;

      // Attempt KB auto-reply for BOT_HANDLED conversations
      // 只對純文字訊息做 KB 檢索；圖片/貼圖/檔案等即使帶了「[圖片]」佔位字，
      // 也不該拿去做語意檢索（會回不相關內容）。contentType 未帶時視為 text 相容舊行為。
      const isTextMessage = !contentType || contentType === 'text';
      let agentHandled = false;
      if (conversationId && text && isTextMessage && botConfig) {
        // 關鍵字命中時讓步給 keyword 規則，不要再讓 AI 回一次。
        // kb-autoreply 早就有這個判斷（見 attemptKbAutoReply 的 1.5），
        // 但 agent 這條漏掉了——結果使用者送出命中關鍵字的訊息後，
        // 會先收到一段 AI 回覆、再收到關鍵字素材，一次兩則。
        // 2026-09-23 使用者指出「關鍵字有命中則 AI 不應再回話」。
        const keywordWillHandle = await hasMatchingKeywordRule(prisma, event.tenantId, text, channelType ?? '', {
          conversationId,
          contactId,
        });
        if (keywordWillHandle) {
          logger.info(`[AutomationWorker] conv=${conversationId} 略過 AI 回覆：關鍵字規則將處理`);
        }
        if (!keywordWillHandle && isAgentEnabled() && shouldRunAgentReply(botConfig.botMode)) {
          try {
            const agentResult = await runAgentReply(prisma, {
              tenantId: event.tenantId,
              conversationId,
              messageId,
              userMessage: text,
              replyToken,
              receivedAt,
              deliver: true,
              io,
            });
            agentHandled = agentResult.handled;
          } catch (err) {
            logger.error('[AutomationWorker] Agent reply error, falling back to KB:', err);
          }
        }
        if (!agentHandled) {
          try {
            await attemptKbAutoReply(prisma, io, event.tenantId, conversationId, text, { replyToken, receivedAt });
          } catch (err) {
            logger.error('[AutomationWorker] KB auto-reply error:', err);
          }
        }
      }

      // Sentiment analysis on inbound messages
      if (text && messageId) {
        try {
          const sentimentResult = await analyzeSentiment(prisma, event.tenantId, text);
          // Update message metadata with sentiment result
          const existingMessage = await prisma.message.findUnique({
            where: { id: messageId },
            select: { metadata: true },
          });
          const existingMetadata = (existingMessage?.metadata as Record<string, unknown>) ?? {};
          await prisma.message.update({
            where: { id: messageId },
            data: {
              metadata: JSON.parse(JSON.stringify({ ...existingMetadata, sentiment: sentimentResult })),
            },
          });
          logger.info(`[AutomationWorker] Sentiment for message ${messageId}: ${sentimentResult.sentiment} (score=${sentimentResult.score}, confidence=${sentimentResult.confidence})`);

          // If negative sentiment with high confidence, publish event
          if (sentimentResult.sentiment === 'negative' && sentimentResult.confidence >= 0.6) {
            eventBus.publish({
              name: 'sentiment.negative',
              tenantId: event.tenantId,
              timestamp: new Date(),
              payload: {
                conversationId,
                messageId,
                contactId,
                sentiment: sentimentResult,
              },
            });
          }
        } catch (err) {
          logger.error('[AutomationWorker] Sentiment analysis error:', err);
        }
      }

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'message.received',
        context: { contactId, conversationId, messageContent: text, channelType, replyToken, receivedAt },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue message.received', err));

      // Check keyword triggers after message.received automation
      if (text) {
        await checkKeywordTriggers(prisma, event.tenantId, text, {
          contactId,
          conversationId,
          messageContent: text,
          channelType,
          replyToken,
          receivedAt,
        });
      }
    } catch (err) {
      logger.error('[AutomationWorker] Error handling message.received:', err);
    }
  });

  // ── keyword.matched ─────────────────────────────────────────────────────
  events.on('keyword.matched', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, messageContent, ruleId, matchedKeywords, matchMode, channelType, replyToken, receivedAt } = event.payload as {
        contactId?: string;
        conversationId?: string;
        messageContent?: string;
        ruleId?: string;
        matchedKeywords?: string[];
        matchMode?: string;
        channelType?: string;
        replyToken?: string;
        receivedAt?: string;
      };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'keyword.matched',
        context: { contactId, conversationId, messageContent, ruleId, matchedKeywords, matchMode, channelType, replyToken, receivedAt },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue keyword.matched', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling keyword.matched:', err);
    }
  });

  // ── case.created ────────────────────────────────────────────────────────
  events.on('case.created', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, caseId } = event.payload as {
        contactId?: string;
        conversationId?: string;
        caseId?: string;
      };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'case.created',
        context: { contactId, conversationId, caseId },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue case.created', err));

      // Auto-classify issue based on latest inbound message
      if (caseId && conversationId) {
        await autoClassifyNewCase(prisma, event.tenantId, caseId, conversationId).catch((err) =>
          logger.error('[AutomationWorker] Auto-classification error:', err),
        );
      }
    } catch (err) {
      logger.error('[AutomationWorker] Error handling case.created:', err);
    }
  });

  // ── conversation.created ────────────────────────────────────────────────
  events.on('conversation.created', async (event: AppEvent) => {
    try {
      const { contactId, conversationId } = event.payload as {
        contactId?: string;
        conversationId?: string;
      };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'conversation.created',
        context: { contactId, conversationId },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue conversation.created', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling conversation.created:', err);
    }
  });

  // ── contact.tagged ──────────────────────────────────────────────────────
  events.on('contact.tagged', async (event: AppEvent) => {
    try {
      const { contactId, source } = event.payload as {
        contactId?: string;
        source?: string;
      };

      // 迴圈防護：automation 規則貼標產生的 contact.tagged 不再觸發評估，
      // 避免「貼標→規則→又貼標」無限迴圈。人工(agent)/點擊(system)貼標才觸發。
      if (source === 'automation') {
        return;
      }

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'contact.tagged',
        context: { contactId },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue contact.tagged', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling contact.tagged:', err);
    }
  });

  // ── contact.created ─────────────────────────────────────────────────────
  events.on('contact.created', async (event: AppEvent) => {
    try {
      const { contactId } = event.payload as { contactId?: string };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'contact.created',
        context: { contactId },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue contact.created', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling contact.created:', err);
    }
  });

  // ── case.escalated ──────────────────────────────────────────────────────
  events.on('case.escalated', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, caseId } = event.payload as {
        contactId?: string;
        conversationId?: string;
        caseId?: string;
      };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'case.escalated',
        context: { contactId, conversationId, caseId },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue case.escalated', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling case.escalated:', err);
    }
  });

  // ── portal.activity.submitted ──────────────────────────────────────────
  events.on('portal.activity.submitted', async (event: AppEvent) => {
    try {
      const { contactId, activityId } = event.payload as {
        contactId?: string;
        activityId?: string;
      };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'portal.activity.submitted',
        context: { contactId, activityId },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue portal.activity.submitted', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling portal.activity.submitted:', err);
    }
  });

  // ── link.clicked ──────────────────────────────────────────────────────────
  events.on('link.clicked', async (event: AppEvent) => {
    try {
      const { contactId, shortLinkId, slug } = event.payload as {
        contactId?: string;
        shortLinkId?: string;
        slug?: string;
      };

      await automationQueue().add('automation:evaluate', {
        tenantId: event.tenantId,
        trigger: 'link.clicked',
        context: { contactId, shortLinkId, slug },
      }).catch((err) => logger.error('[AutomationWorker] Failed to enqueue link.clicked', err));
    } catch (err) {
      logger.error('[AutomationWorker] Error handling link.clicked:', err);
    }
  });

  return events.handle;
}
