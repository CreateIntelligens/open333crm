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
import { deliverToChannel } from '../conversation/conversation.service.js';

const MAX_BOT_REPLIES_BEFORE_HANDOFF = 5;
const HANDOFF_KEYWORDS = ['真人', '人工', '客服', '轉接'];

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
    });

    if (!conversation) return; // Not a BOT_HANDLED conversation

    let shouldHandoff = false;
    let reason = '';

    // Check 1: Bot replies count exceeded threshold
    if (conversation.botRepliesCount >= MAX_BOT_REPLIES_BEFORE_HANDOFF) {
      shouldHandoff = true;
      reason = `Bot 回覆次數已達上限 (${conversation.botRepliesCount})`;
    }

    // Check 2: Keyword match for human agent request
    if (!shouldHandoff && messageContent) {
      const lowerContent = messageContent.toLowerCase();
      for (const keyword of HANDOFF_KEYWORDS) {
        if (lowerContent.includes(keyword)) {
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
      // Auto-handoff: change status to AGENT_HANDLED
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'AGENT_HANDLED',
          handoffReason: reason,
        },
      });

      // Send system message
      const now = new Date();
      const systemMessage = await prisma.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: { text: `自動轉接人工客服：${reason}` },
          metadata: { type: 'auto_handoff', reason },
          isRead: true,
          createdAt: now,
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });

      // Deliver handoff notification to channel (LINE/FB)
      const handoffText = `自動轉接人工客服：${reason}`;
      await deliverToChannel(prisma, conversationId, handoffText);

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
      const { contactId, conversationId, messageContent, content, contentType } = event.payload as {
        contactId?: string;
        conversationId?: string;
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

  console.log('[AutomationWorker] Subscribed to events: message.received, keyword.matched, case.created, conversation.created, contact.tagged, case.escalated');
  console.log('[AutomationWorker] Auto-handoff enabled: max bot replies =', MAX_BOT_REPLIES_BEFORE_HANDOFF, ', keywords =', HANDOFF_KEYWORDS.join(', '));
}
