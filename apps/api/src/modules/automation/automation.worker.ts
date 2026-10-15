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
import { attemptKbAutoReply } from '../ai/kb-autoreply.service.js';
import { analyzeSentiment } from '../ai/sentiment.service.js';
import { autoClassifyNewCase } from '../ai/classify.service.js';
import { isAgentEnabled, runAgentReply } from '../ai/agent/agent.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { logger } from '@open333crm/core';
import { AUTOMATION_DELIVERY_CHANNEL_TYPES } from '@open333crm/channel-plugins';
import { buildAutomationFacts, evaluateRules, validateAutomationRuleContract } from '@open333crm/automation';

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

export type HandoffPromptStyle = 'text' | 'button' | 'both' | 'none';

export interface BotConfig {
  botMode: 'keyword' | 'llm' | 'keyword_then_llm' | 'off';
  maxBotReplies: number;
  handoffKeywords: string[];
  handoffMessage: string;
  offlineGreeting?: string;
  handoffPromptEnabled: boolean;
  handoffPromptStyle: HandoffPromptStyle;
  handoffButtonLabel: string;
}

export const DEFAULT_HANDOFF_PROMPT_TEXT =
  '需要真人客服協助嗎？請輸入「真人」或「客服」即可轉接。';

export const DEFAULT_BOT_CONFIG: BotConfig = {
  botMode: 'keyword_then_llm',
  maxBotReplies: 5,
  handoffKeywords: ['真人', '人工', '客服', '轉接'],
  handoffMessage: '稍等，正在為您轉接客服人員',
  handoffPromptEnabled: true,
  handoffPromptStyle: 'button',
  handoffButtonLabel: '💬 轉接客服',
};

export function shouldRunAgentReply(botMode: BotConfig['botMode']): boolean {
  return botMode === 'llm' || botMode === 'keyword_then_llm';
}

function getBotConfig(settings: unknown): BotConfig {
  const channelSettings = (settings || {}) as Record<string, unknown>;
  const rawBotConfig = (channelSettings.botConfig || {}) as Partial<BotConfig>;
  return { ...DEFAULT_BOT_CONFIG, ...rawBotConfig };
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
 * 訊息命中的 active keyword.matched 規則中，有沒有能在這個渠道回覆顧客的動作。
 * agent 與 KB 自動回覆用來決定是否讓步（命中就讓 keyword 規則回，避免一次兩則）。
 * 只加標籤、或素材是別的渠道的規則不算：workers 不會替它回覆，AI 讓步的話顧客什麼都收不到
 * （change fix-keyword-yield-ig-delivery）。
 * 不通過契約驗證或條件不成立的規則也不算：workers 會略過這種規則（change fix-automation-rule-gaps）。
 * 條件用與 workers 相同的 buildAutomationFacts 評估，對同一則訊息得出相同結果。
 */
export async function hasMatchingKeywordRule(
  prisma: PrismaClient,
  tenantId: string,
  messageText: string,
  channelType: string,
  factContext: { conversationId?: string; contactId?: string } = {},
): Promise<boolean> {
  if (!messageText) return false;
  // workers 送不到的渠道，規則命中也回覆不了顧客
  if (!AUTOMATION_DELIVERY_CHANNEL_TYPES.includes(channelType.toUpperCase())) return false;
  const rules = await prisma.automationRule.findMany({
    where: { tenantId, isActive: true },
  });
  const lowerText = messageText.toLowerCase();
  const matchedRules = rules.filter((rule) => {
    const trigger = rule.trigger as Record<string, unknown>;
    if (trigger?.type !== 'keyword.matched') return false;
    // 存檔資料可能有非字串或空白值；空字串會命中所有訊息，一併排除
    const keywords = Array.isArray(trigger.keywords)
      ? trigger.keywords.filter((kw): kw is string => typeof kw === 'string' && kw.trim().length > 0)
      : [];
    const matchMode = (trigger.match_mode as string) || 'any';
    if (keywords.length === 0) return false;
    return matchMode === 'all'
      ? keywords.every((kw) => lowerText.includes(kw.toLowerCase()))
      : keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
  });
  if (matchedRules.length === 0) return false;

  // workers 驗證失敗就整條略過（automation.handler.ts）
  const validRules = matchedRules.filter(
    (rule) =>
      validateAutomationRuleContract({
        eventName: 'keyword.matched',
        conditions: rule.conditions,
        actions: rule.actions,
      }).valid,
  );
  if (validRules.length === 0) return false;

  // 條件不成立時 workers 不執行規則，AI 讓步的話顧客什麼都收不到（問題清單 A09）
  const facts = await buildAutomationFacts(prisma, {
    tenantId,
    conversationId: factContext.conversationId,
    contactId: factContext.contactId,
    messageContent: messageText,
  });
  const passed = await evaluateRules(
    validRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      stopOnMatch: rule.stopOnMatch,
      conditions: rule.conditions as any,
      actions: [],
    })),
    facts,
  );
  const passedIds = new Set(passed.map((m) => m.ruleId));
  const firingRules = validRules.filter((rule) => passedIds.has(rule.id));

  const actions = firingRules.flatMap((rule) =>
    Array.isArray(rule.actions) ? (rule.actions as Array<{ type?: string; params?: Record<string, unknown> }>) : [],
  );
  if (actions.some((a) => a.type === 'send_message')) return true;

  // 與 workers 的 send_material 相同：素材渠道與對話渠道不同時不會送出
  const materialIds = actions
    .filter((a) => a.type === 'send_material' && typeof a.params?.materialId === 'string')
    .map((a) => a.params!.materialId as string);
  if (materialIds.length === 0) return false;
  const materials = await prisma.material.findMany({
    where: { id: { in: materialIds }, tenantId },
    select: { channelType: true },
  });
  const target = channelType.toLowerCase();
  return materials.some((m) => m.channelType?.toLowerCase() === target);
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

export function setupAutomationWorker(prisma: PrismaClient, io: Server) {
  // ── message.received ────────────────────────────────────────────────────
  eventBus.subscribe('message.received', async (event: AppEvent) => {
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
  eventBus.subscribe('keyword.matched', async (event: AppEvent) => {
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
  eventBus.subscribe('case.created', async (event: AppEvent) => {
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
  eventBus.subscribe('conversation.created', async (event: AppEvent) => {
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
  eventBus.subscribe('contact.tagged', async (event: AppEvent) => {
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
  eventBus.subscribe('contact.created', async (event: AppEvent) => {
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
  eventBus.subscribe('case.escalated', async (event: AppEvent) => {
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
  eventBus.subscribe('portal.activity.submitted', async (event: AppEvent) => {
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
  eventBus.subscribe('link.clicked', async (event: AppEvent) => {
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

  logger.info('[AutomationWorker] Subscribed to events: message.received, keyword.matched, case.created, conversation.created, contact.created, contact.tagged, case.escalated, portal.activity.submitted, link.clicked');
  logger.info('[AutomationWorker] Auto-handoff enabled with configurable BotConfig per channel');
}
