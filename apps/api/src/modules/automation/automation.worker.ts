/**
 * Automation event-bus worker.
 *
 * Subscribes to application events and triggers automation rule evaluation.
 * Runs in-process alongside the API server (not a separate worker process).
 */

import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { eventBus } from '../../events/event-bus.js';
import type { AppEvent } from '../../events/event-bus.js';
import { triggerAutomation } from './automation.service.js';
import { attemptKbAutoReply } from '../ai/kb-autoreply.service.js';
import { analyzeSentiment } from '../ai/sentiment.service.js';
import { classifyIssue } from '../ai/classify.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';

interface BotConfig {
  botMode: 'keyword' | 'llm' | 'keyword_then_llm' | 'off';
  maxBotReplies: number;
  handoffKeywords: string[];
  handoffMessage: string;
  offlineGreeting?: string;
}

const DEFAULT_BOT_CONFIG: BotConfig = {
  botMode: 'keyword_then_llm',
  maxBotReplies: 5,
  handoffKeywords: ['真人', '人工', '客服', '轉接'],
  handoffMessage: '稍等，正在為您轉接客服人員',
};

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
    const channelSettings = (conversation.channel?.settings || {}) as Record<string, unknown>;
    const rawBotConfig = (channelSettings.botConfig || {}) as Partial<BotConfig>;
    const botConfig: BotConfig = {
      ...DEFAULT_BOT_CONFIG,
      ...rawBotConfig,
    };

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
        const summaryResult = await summarizeConversation(prisma, conversationId);
        summary = summaryResult.summary;
      } catch (err) {
        console.error('[AutoHandoff] Failed to generate summary:', err);
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

      const systemMessage = await prisma.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: { text: systemText },
          metadata: { type: 'auto_handoff', reason, summary: summary || undefined },
          isRead: true,
          createdAt: now,
        },
      });

      await prisma.conversation.update({
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
      const wsPayload = {
        id: conversationId,
        status: 'AGENT_HANDLED',
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

      console.log(`[AutoHandoff] Conversation ${conversationId} auto-escalated: ${reason}`);
    }
  } catch (err) {
    console.error('[AutoHandoff] Error:', err);
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

    const lowerText = messageText.toLowerCase();

    for (const rule of keywordRules) {
      const trigger = rule.trigger as Record<string, unknown>;
      const keywords = (trigger.keywords as string[]) || [];
      const matchMode = (trigger.match_mode as string) || 'any';

      if (keywords.length === 0) continue;

      let matched = false;
      const matchedKeywords: string[] = [];

      if (matchMode === 'all') {
        // All keywords must be present
        matched = keywords.every((kw) => {
          const found = lowerText.includes(kw.toLowerCase());
          if (found) matchedKeywords.push(kw);
          return found;
        });
      } else {
        // Any keyword must be present (default)
        for (const kw of keywords) {
          if (lowerText.includes(kw.toLowerCase())) {
            matchedKeywords.push(kw);
            matched = true;
          }
        }
      }

      if (matched) {
        console.log(`[AutomationWorker] keyword.matched: rule="${rule.name}", keywords=[${matchedKeywords.join(', ')}]`);

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
    console.error('[AutomationWorker] Error checking keyword triggers:', err);
  }
}

export function setupAutomationWorker(prisma: PrismaClient, io: Server) {
  // ── message.received ────────────────────────────────────────────────────
  eventBus.subscribe('message.received', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, messageId, messageContent, content, contentType } = event.payload as {
        contactId?: string;
        conversationId?: string;
        messageId?: string;
        messageContent?: string;
        content?: { text?: string };
        contentType?: string;
      };

      // Extract message text from either direct messageContent or content.text
      const text = messageContent ?? content?.text ?? undefined;

      // Check auto-handoff for BOT_HANDLED conversations
      if (conversationId) {
        await checkAutoHandoff(prisma, io, event.tenantId, conversationId, text, contentType);
      }

      // Attempt KB auto-reply for BOT_HANDLED conversations
      if (conversationId && text) {
        try {
          await attemptKbAutoReply(prisma, io, event.tenantId, conversationId, text);
        } catch (err) {
          console.error('[AutomationWorker] KB auto-reply error:', err);
        }
      }

      // Sentiment analysis on inbound messages
      if (text && messageId) {
        try {
          const sentimentResult = await analyzeSentiment(text);
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
          console.log(`[AutomationWorker] Sentiment for message ${messageId}: ${sentimentResult.sentiment} (score=${sentimentResult.score}, confidence=${sentimentResult.confidence})`);

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
          console.error('[AutomationWorker] Sentiment analysis error:', err);
        }
      }

      await triggerAutomation(prisma, io, event.tenantId, 'message.received', {
        contactId: contactId as string | undefined,
        conversationId: conversationId as string | undefined,
        messageContent: text,
      });

      // Check keyword triggers after message.received automation
      if (text) {
        await checkKeywordTriggers(prisma, event.tenantId, text, {
          contactId,
          conversationId,
          messageContent: text,
        });
      }
    } catch (err) {
      console.error('[AutomationWorker] Error handling message.received:', err);
    }
  });

  // ── keyword.matched ─────────────────────────────────────────────────────
  eventBus.subscribe('keyword.matched', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, messageContent } = event.payload as {
        contactId?: string;
        conversationId?: string;
        messageContent?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'keyword.matched', {
        contactId: contactId as string | undefined,
        conversationId: conversationId as string | undefined,
        messageContent: messageContent as string | undefined,
      });
    } catch (err) {
      console.error('[AutomationWorker] Error handling keyword.matched:', err);
    }
  });

  // ── case.created ────────────────────────────────────────────────────────
  eventBus.subscribe('case.created', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, caseId } = event.payload as {
        contactId?: string;
        conversationId?: string;
        caseId?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'case.created', {
        contactId: contactId as string | undefined,
        conversationId: conversationId as string | undefined,
        caseId: caseId as string | undefined,
      });

      // Auto-classify issue based on latest inbound message
      if (caseId && conversationId) {
        try {
          const latestMessage = await prisma.message.findFirst({
            where: { conversationId, direction: 'INBOUND' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          const messageText = (latestMessage?.content as Record<string, unknown>)?.text as string | undefined;
          if (messageText) {
            const classification = await classifyIssue(messageText);
            await prisma.case.update({
              where: { id: caseId },
              data: { category: classification.category },
            });
            console.log(`[AutomationWorker] Case ${caseId} auto-classified: ${classification.category} (confidence=${classification.confidence})`);
          }
        } catch (err) {
          console.error('[AutomationWorker] Auto-classification error:', err);
        }
      }
    } catch (err) {
      console.error('[AutomationWorker] Error handling case.created:', err);
    }
  });

  // ── conversation.created ────────────────────────────────────────────────
  eventBus.subscribe('conversation.created', async (event: AppEvent) => {
    try {
      const { contactId, conversationId } = event.payload as {
        contactId?: string;
        conversationId?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'conversation.created', {
        contactId: contactId as string | undefined,
        conversationId: conversationId as string | undefined,
      });
    } catch (err) {
      console.error('[AutomationWorker] Error handling conversation.created:', err);
    }
  });

  // ── contact.tagged ──────────────────────────────────────────────────────
  eventBus.subscribe('contact.tagged', async (event: AppEvent) => {
    try {
      const { contactId } = event.payload as {
        contactId?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'contact.tagged', {
        contactId: contactId as string | undefined,
      });
    } catch (err) {
      console.error('[AutomationWorker] Error handling contact.tagged:', err);
    }
  });

  // ── case.escalated ──────────────────────────────────────────────────────
  eventBus.subscribe('case.escalated', async (event: AppEvent) => {
    try {
      const { contactId, conversationId, caseId } = event.payload as {
        contactId?: string;
        conversationId?: string;
        caseId?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'case.escalated', {
        contactId: contactId as string | undefined,
        conversationId: conversationId as string | undefined,
        caseId: caseId as string | undefined,
      });
    } catch (err) {
      console.error('[AutomationWorker] Error handling case.escalated:', err);
    }
  });

  // ── portal.activity.submitted ──────────────────────────────────────────
  eventBus.subscribe('portal.activity.submitted', async (event: AppEvent) => {
    try {
      const { contactId, activityId } = event.payload as {
        contactId?: string;
        activityId?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'portal.activity.submitted', {
        contactId: contactId as string | undefined,
        activityId: activityId as string | undefined,
      });
    } catch (err) {
      console.error('[AutomationWorker] Error handling portal.activity.submitted:', err);
    }
  });

  // ── link.clicked ──────────────────────────────────────────────────────────
  eventBus.subscribe('link.clicked', async (event: AppEvent) => {
    try {
      const { contactId, shortLinkId } = event.payload as {
        contactId?: string;
        shortLinkId?: string;
      };

      await triggerAutomation(prisma, io, event.tenantId, 'link.clicked', {
        contactId: contactId as string | undefined,
        shortLinkId: shortLinkId as string | undefined,
      });
    } catch (err) {
      console.error('[AutomationWorker] Error handling link.clicked:', err);
    }
  });

  console.log('[AutomationWorker] Subscribed to events: message.received, keyword.matched, case.created, conversation.created, contact.tagged, case.escalated, portal.activity.submitted, link.clicked');
  console.log('[AutomationWorker] Auto-handoff enabled with configurable BotConfig per channel');
}
