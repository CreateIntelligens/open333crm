/**
 * 自動化訂閱者：處理 event-automation 佇列的事件（change outbox-event-delivery，design 決策 8）。
 *
 * - 每個事件送出一個 automation:evaluate job，job id 是事件 id，事件重送時不會評估兩次。
 *   規則評估與動作在 apps/workers 執行；關鍵字規則由 workers 處理 message.received 時比對。
 * - message.received 另外依序做自動轉接、agent 或 KB 回覆、情緒分析。
 *   呼叫 LLM、去識別化服務的階段在交易之外，用 prismaAdmin；認領、寫入結果與發出衍生事件
 *   放在一個 inTenant() 交易內，所以同一則訊息處理兩次時，每個副作用最多發生一次。
 */

import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import { Queue } from 'bullmq';
import { claimOne, claimSideEffect, hasSideEffectClaim, logger } from '@open333crm/core';
import { getBotConfig, hasMatchingKeywordRule, shouldRunAgentReply, type BotConfig } from '@open333crm/automation';
import { createEventRouter, type EventHandler, type SubscribedEvent } from '../../events/subscriber-workers.js';
import { createOutboxPublisher } from '../../events/outbox-publisher.js';
import { inTenant, type TenantCtxDeps } from '../../lib/tenant-ctx.js';
import { attemptKbAutoReply } from '../ai/kb-autoreply.service.js';
import { prepareStoredMessageContent } from '../ai/deidentification.service.js';
import { analyzeSentiment } from '../ai/sentiment.service.js';
import { autoClassifyNewCase } from '../ai/classify.service.js';
import { isAgentEnabled, runAgentReply } from '../ai/agent/agent.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { createBotReplyGuard } from './bot-reply-guard.js';

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL，
// ioredis fallback default 6379 會噴一堆 ECONNREFUSED 噪音
let _automationQueue: Queue | null = null;
function automationQueue(): Queue {
  if (!_automationQueue) {
    _automationQueue = new Queue('automation', {
      connection: { url: process.env.REDIS_URL! },
      // job id 是事件 id：完成的 job 保留 24 小時，這段時間內事件重送不會再評估一次。
      // workers 執行規則動作之前都以 automation_action 認領，所以可以重試
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return _automationQueue;
}

/** 送出規則評估。eventId 供 workers 認領規則動作（automation_action） */
async function enqueueEvaluate(event: SubscribedEvent, trigger: string, context: Record<string, unknown>) {
  await automationQueue()
    .add('automation:evaluate', { tenantId: event.tenantId, eventId: event.id, trigger, context }, { jobId: event.id })
    .catch((err) => logger.error(`[AutomationWorker] Failed to enqueue ${trigger}`, err));
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

/**
 * 自動轉接人工（bot-handoff-config「自動轉接每次只發生一次」）。
 *
 * 判斷、摘要與遮罩都在交易之外。交易內以條件更新把對話從 BOT_HANDLED 改成 AGENT_HANDLED，
 * 成功才寫系統訊息、認領 bot_reply、發出 conversation.handoff；commit 之後才送出轉接訊息。
 */
async function checkAutoHandoff(
  prisma: PrismaClient,
  tenantDeps: TenantCtxDeps,
  io: Server,
  tenantId: string,
  conversationId: string,
  messageContent: string | undefined,
  contentType: string | undefined,
  inboundMessageId: string | undefined,
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

    if (!shouldHandoff) return;

    // 外部呼叫在交易之前：摘要（LLM）與系統訊息的遮罩（去識別化服務）
    let summary = '';
    try {
      const { summarizeConversation } = await import('../ai/ai.service.js');
      const summaryResult = await summarizeConversation(prisma, tenantId, conversationId);
      summary = summaryResult.summary;
    } catch (err) {
      logger.error('[AutoHandoff] Failed to generate summary:', err);
    }
    const now = new Date();
    const systemText = summary
      ? `自動轉接人工客服：${reason}\n\n📋 Bot 對話摘要：\n${summary}`
      : `自動轉接人工客服：${reason}`;
    const storedContent = await prepareStoredMessageContent(prisma, tenantId, { text: systemText }, 'system');

    // 轉接訊息也是對這則入站訊息的機器人回覆，與對話狀態一起認領
    const replyGuard = createBotReplyGuard(tenantDeps, prisma, tenantId, inboundMessageId);
    const handedOff = await replyGuard.persist(async (tx, ctx) => {
      const claimed = await claimOne(() =>
        tx.conversation.updateMany({
          where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
          data: { status: 'AGENT_HANDLED', handoffReason: reason, lastMessageAt: now },
        }),
      );
      // 另一個處理已經轉接了這段對話
      if (!claimed) return null;

      const systemMessage = await tx.message.create({
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
      await ctx.publish('conversation.handoff', {
        conversationId,
        reason,
        summary,
        previousStatus: 'BOT_HANDLED',
      });
      const updatedConversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
      return { systemMessage, updatedConversation };
    });
    if (!handedOff) return;

    // Deliver configurable handoff message to channel
    await deliverToChannel(prisma, conversationId, botConfig.handoffMessage);

    // Emit WebSocket events
    const { systemMessage, updatedConversation } = handedOff;
    if (updatedConversation) {
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
    }

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
  } catch (err) {
    logger.error('[AutoHandoff] Error:', err);
  }
}

/**
 * 情緒分析（automation-engine「情緒分析每則訊息最多一次」）。呼叫 LLM 之前先查有沒有 sentiment 認領；
 * LLM 之後在一個交易內認領、寫入結果，負面且信心值至少 0.6 時發出 sentiment.negative。
 */
async function analyzeSentimentOnce(
  prisma: PrismaClient,
  tenantDeps: TenantCtxDeps,
  tenantId: string,
  messageId: string,
  text: string,
  refs: { conversationId?: string; contactId?: string },
) {
  const key = { tenantId, kind: 'sentiment' as const, sourceId: messageId };
  if (await hasSideEffectClaim(prisma, key)) return;

  const sentimentResult = await analyzeSentiment(prisma, tenantId, text);
  const written = await inTenant(tenantDeps, tenantId, async (ctx) => {
    // 兩次處理同時通過上面的檢查時，只有一次寫入結果
    if (!(await claimSideEffect(ctx.tx, key))) return false;
    const existingMessage = await ctx.tx.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    const existingMetadata = (existingMessage?.metadata as Record<string, unknown>) ?? {};
    await ctx.tx.message.update({
      where: { id: messageId },
      data: {
        metadata: JSON.parse(JSON.stringify({ ...existingMetadata, sentiment: sentimentResult })),
      },
    });
    if (sentimentResult.sentiment === 'negative' && sentimentResult.confidence >= 0.6) {
      await ctx.publish('sentiment.negative', {
        conversationId: refs.conversationId,
        messageId,
        contactId: refs.contactId,
        sentiment: sentimentResult,
      });
    }
    return true;
  });
  if (written) {
    logger.info(`[AutomationWorker] Sentiment for message ${messageId}: ${sentimentResult.sentiment} (score=${sentimentResult.score}, confidence=${sentimentResult.confidence})`);
  }
}

/**
 * prisma：交易外的查詢與 LLM 階段用的 admin 連線，查詢都自帶 tenantId。
 * tenantPrisma：inTenant() 的基礎連線（受 RLS 約束），認領與寫入結果用它。
 */
export function setupAutomationWorker(prisma: PrismaClient, io: Server, tenantPrisma: PrismaClient): EventHandler {
  const events = createEventRouter();
  const tenantDeps: TenantCtxDeps = { prisma: tenantPrisma, io, events: createOutboxPublisher(tenantPrisma) };

  // ── message.received ────────────────────────────────────────────────────
  events.on('message.received', async (event: SubscribedEvent) => {
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
        await checkAutoHandoff(prisma, tenantDeps, io, event.tenantId, conversationId, text, contentType, messageId);
      }

      const botConfig = conversationId
        ? await getConversationBotConfig(prisma, event.tenantId, conversationId)
        : null;

      // Attempt KB auto-reply for BOT_HANDLED conversations
      // 只對純文字訊息做 KB 檢索；圖片/貼圖/檔案等即使帶了「[圖片]」佔位字，
      // 也不該拿去做語意檢索（會回不相關內容）。contentType 未帶時視為 text 相容舊行為。
      const isTextMessage = !contentType || contentType === 'text';
      const replyGuard = createBotReplyGuard(tenantDeps, prisma, event.tenantId, messageId);
      if (conversationId && text && isTextMessage && botConfig && (await replyGuard.alreadyReplied())) {
        // 事件重送：這則訊息已經有機器人回覆，不再呼叫 LLM
        logger.info(`[AutomationWorker] conv=${conversationId} 略過 AI 回覆：這則訊息已有機器人回覆`);
      } else if (conversationId && text && isTextMessage && botConfig) {
        let agentHandled = false;
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
              replyGuard,
            });
            agentHandled = agentResult.handled;
          } catch (err) {
            logger.error('[AutomationWorker] Agent reply error, falling back to KB:', err);
          }
        }
        if (!agentHandled) {
          try {
            await attemptKbAutoReply(prisma, io, event.tenantId, conversationId, text, { replyToken, receivedAt }, replyGuard);
          } catch (err) {
            logger.error('[AutomationWorker] KB auto-reply error:', err);
          }
        }
      }

      // Sentiment analysis on inbound messages
      if (text && messageId) {
        try {
          await analyzeSentimentOnce(prisma, tenantDeps, event.tenantId, messageId, text, { conversationId, contactId });
        } catch (err) {
          logger.error('[AutomationWorker] Sentiment analysis error:', err);
        }
      }

      // 關鍵字規則由 workers 評估這個 job 時一併比對（design 決策 9）；入站訊息 id 供 keyword_matched 認領
      await enqueueEvaluate(event, 'message.received', {
        contactId,
        conversationId,
        messageId,
        messageContent: text,
        channelType,
        replyToken,
        receivedAt,
      });
    } catch (err) {
      logger.error('[AutomationWorker] Error handling message.received:', err);
    }
  });

  // ── case.created ────────────────────────────────────────────────────────
  events.on('case.created', async (event: SubscribedEvent) => {
    try {
      const { contactId, conversationId, caseId } = event.payload as {
        contactId?: string;
        conversationId?: string;
        caseId?: string;
      };

      await enqueueEvaluate(event, 'case.created', { contactId, conversationId, caseId });

      // Auto-classify issue based on latest inbound message
      // 重複執行時不改變結果（主規格「新工單的自動分類不覆蓋既有分類」），只多一次 LLM 費用
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
  events.on('conversation.created', async (event: SubscribedEvent) => {
    const { contactId, conversationId } = event.payload as {
      contactId?: string;
      conversationId?: string;
    };
    await enqueueEvaluate(event, 'conversation.created', { contactId, conversationId });
  });

  // ── contact.tagged ──────────────────────────────────────────────────────
  events.on('contact.tagged', async (event: SubscribedEvent) => {
    const { contactId, source } = event.payload as {
      contactId?: string;
      source?: string;
    };

    // 迴圈防護：automation 規則貼標產生的 contact.tagged 不再觸發評估，
    // 避免「貼標→規則→又貼標」無限迴圈。人工(agent)/點擊(system)貼標才觸發。
    if (source === 'automation') {
      return;
    }

    await enqueueEvaluate(event, 'contact.tagged', { contactId });
  });

  // ── contact.created ─────────────────────────────────────────────────────
  events.on('contact.created', async (event: SubscribedEvent) => {
    const { contactId } = event.payload as { contactId?: string };
    await enqueueEvaluate(event, 'contact.created', { contactId });
  });

  // ── case.escalated ──────────────────────────────────────────────────────
  events.on('case.escalated', async (event: SubscribedEvent) => {
    const { contactId, conversationId, caseId } = event.payload as {
      contactId?: string;
      conversationId?: string;
      caseId?: string;
    };
    await enqueueEvaluate(event, 'case.escalated', { contactId, conversationId, caseId });
  });

  // ── portal.activity.submitted ──────────────────────────────────────────
  events.on('portal.activity.submitted', async (event: SubscribedEvent) => {
    const { contactId, activityId } = event.payload as {
      contactId?: string;
      activityId?: string;
    };
    await enqueueEvaluate(event, 'portal.activity.submitted', { contactId, activityId });
  });

  // ── link.clicked ──────────────────────────────────────────────────────────
  events.on('link.clicked', async (event: SubscribedEvent) => {
    const { contactId, shortLinkId, slug } = event.payload as {
      contactId?: string;
      shortLinkId?: string;
      slug?: string;
    };
    await enqueueEvaluate(event, 'link.clicked', { contactId, shortLinkId, slug });
  });

  return events.handle;
}
