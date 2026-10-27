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
import { getBotConfig, shouldRunAgentReply, type BotConfig } from '@open333crm/automation';
import { hasMatchingKeywordRule } from './keyword-yield.js';
import { createEventRouter, type EventHandler, type SubscribedEvent } from '../../events/subscriber-workers.js';
import { createOutboxPublisher, publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import { inTenant } from '../../lib/tenant-ctx.js';

/** 認領與寫入結果的交易：tenantPrisma 是 inTenant() 的基礎連線（受 RLS 約束），events 寫 outbox */
interface TenantDeps {
  tenantPrisma: PrismaClient;
  events: EventPublisher;
}
import { attemptKbAutoReply } from '../ai/kb-autoreply.service.js';
import { prepareStoredMessageContent } from '../ai/deidentification.service.js';
import { analyzeSentiment } from '../ai/sentiment.service.js';
import { autoClassifyNewCase } from '../ai/classify.service.js';
import { isAgentEnabled, runAgentReply } from '../ai/agent/agent.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { ClaimTransactionError, createBotReplyGuard } from './bot-reply-guard.js';

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

/**
 * 送出規則評估。eventId 供 workers 認領規則動作（automation_action）。
 * 送不出時丟錯：訂閱者的 job 失敗，由 BullMQ 重試（event-delivery「每個訂閱者各自處理」）
 */
async function enqueueEvaluate(
  event: SubscribedEvent,
  trigger: string,
  context: Record<string, unknown>,
  jobId: string = event.id,
) {
  await automationQueue().add('automation:evaluate', { tenantId: event.tenantId, eventId: event.id, trigger, context }, { jobId });
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
 * commit 之前的失敗往外丟，由佇列重試；commit 之後送出轉接訊息的失敗只記 log。
 */
async function checkAutoHandoff(
  prisma: PrismaClient,
  tenantDeps: TenantDeps,
  io: Server,
  tenantId: string,
  conversationId: string,
  messageContent: string | undefined,
  contentType: string | undefined,
  inboundMessageId: string | undefined,
) {
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
  const replyGuard = createBotReplyGuard(tenantDeps.tenantPrisma, prisma, tenantId, inboundMessageId);
  const handedOff = await replyGuard.persist(async (tx, scope) => {
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
    await publishEvent(scope, tenantDeps.events, 'conversation.handoff', {
      conversationId,
      reason,
      summary,
      previousStatus: 'BOT_HANDLED',
    });
    const updatedConversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
    return { systemMessage, updatedConversation };
  });
  if (!handedOff) return;

  // 以下在轉接 commit 之後：失敗只記 log，不重試（轉接訊息最多送出一次）
  try {
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
    logger.error('[AutoHandoff] 轉接之後送出轉接訊息或推播失敗:', err);
  }
}

/**
 * 情緒分析（automation-engine「情緒分析每則訊息最多一次」）。呼叫 LLM 之前先查有沒有 sentiment 認領；
 * LLM 之後在一個交易內認領、寫入結果，負面且信心值至少 0.6 時發出 sentiment.negative。
 * LLM 失敗時改用關鍵字判斷的結果（analyzeSentiment() 內的降級）；查認領紀錄與交易的失敗往外丟，由佇列重試。
 */
async function analyzeSentimentOnce(
  prisma: PrismaClient,
  tenantDeps: TenantDeps,
  tenantId: string,
  messageId: string,
  text: string,
  refs: { conversationId?: string; contactId?: string },
) {
  const key = { tenantId, kind: 'sentiment' as const, sourceId: messageId };
  if (await hasSideEffectClaim(prisma, key)) return;

  // LLM 失敗時，analyzeSentiment() 自己改用關鍵字判斷，不丟錯（降級）
  const sentimentResult = await analyzeSentiment(prisma, tenantId, text);
  const written = await inTenant(tenantDeps.tenantPrisma, tenantId, async (scope) => {
    // 兩次處理同時通過上面的檢查時，只有一次寫入結果
    if (!(await claimSideEffect(scope.tx, key))) return false;
    const existingMessage = await scope.tx.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    const existingMetadata = (existingMessage?.metadata as Record<string, unknown>) ?? {};
    await scope.tx.message.update({
      where: { id: messageId },
      data: {
        metadata: JSON.parse(JSON.stringify({ ...existingMetadata, sentiment: sentimentResult })),
      },
    });
    if (sentimentResult.sentiment === 'negative' && sentimentResult.confidence >= 0.6) {
      await publishEvent(scope, tenantDeps.events, 'sentiment.negative', {
        conversationId: refs.conversationId,
        messageId,
        contactId: refs.contactId,
        sentiment: sentimentResult,
      });
    }
    return true;
  }).catch((err: unknown) => {
    throw new ClaimTransactionError(err);
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
  const tenantDeps: TenantDeps = { tenantPrisma, events: createOutboxPublisher(tenantPrisma) };

  // ── message.received ────────────────────────────────────────────────────
  events.on('message.received', async (event: SubscribedEvent) => {
    // 每個步驟都執行，失敗的步驟最後一起丟錯，由佇列重試；重試時已完成的步驟都已認領，會略過。
    // 只有「認領之前」的失敗會丟到這裡：LLM 失敗改用 KB、KB 找不到答案這類降級照舊只記 log
    const failures: unknown[] = [];
    {
      const { contactId, conversationId, messageId, messageContent, content, contentType, channelType, replyToken, receivedAt, isFirstFollow } = event.payload as {
        contactId?: string;
        conversationId?: string;
        messageId?: string;
        messageContent?: string;
        content?: { text?: string };
        contentType?: string;
        channelType?: string;
        replyToken?: string;
        receivedAt?: string;
        isFirstFollow?: boolean;
      };

      // 加入好友（LINE follow）是系統事件，不是顧客打的字：不帶文字，workers 不拿它比對關鍵字規則（design D28）
      const isFollow = contentType === 'follow';

      // Extract message text from either direct messageContent or content.text
      const text = isFollow ? undefined : (messageContent ?? content?.text ?? undefined);

      // Check auto-handoff for BOT_HANDLED conversations
      let handoffFailed = false;
      if (conversationId) {
        try {
          await checkAutoHandoff(prisma, tenantDeps, io, event.tenantId, conversationId, text, contentType, messageId);
        } catch (err) {
          logger.error('[AutomationWorker] Auto-handoff failed, will retry:', err);
          failures.push(err);
          handoffFailed = true;
        }
      }

      // 轉接失敗時這次不做 AI 回覆：AI 回覆會先認領 bot_reply，重試時轉接就認領不到
      if (!handoffFailed) {
        try {
          const botConfig = conversationId
            ? await getConversationBotConfig(prisma, event.tenantId, conversationId)
            : null;

          // Attempt KB auto-reply for BOT_HANDLED conversations
          // 只對純文字訊息做 KB 檢索；圖片/貼圖/檔案等即使帶了「[圖片]」佔位字，
          // 也不該拿去做語意檢索（會回不相關內容）。contentType 未帶時視為 text 相容舊行為。
          const isTextMessage = !contentType || contentType === 'text';
          const replyGuard = createBotReplyGuard(tenantDeps.tenantPrisma, prisma, event.tenantId, messageId);
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
                if (err instanceof ClaimTransactionError) throw err;
                logger.error('[AutomationWorker] Agent reply error, falling back to KB:', err);
              }
            }
            if (!agentHandled) {
              try {
                await attemptKbAutoReply(prisma, io, event.tenantId, conversationId, text, { replyToken, receivedAt }, replyGuard);
              } catch (err) {
                if (err instanceof ClaimTransactionError) throw err;
                logger.error('[AutomationWorker] KB auto-reply error:', err);
              }
            }
          }
        } catch (err) {
          logger.error('[AutomationWorker] AI reply failed, will retry:', err);
          failures.push(err);
        }
      }

      // Sentiment analysis on inbound messages
      if (text && messageId) {
        try {
          await analyzeSentimentOnce(prisma, tenantDeps, event.tenantId, messageId, text, { conversationId, contactId });
        } catch (err) {
          // LLM 失敗已在 analyzeSentiment() 內降級；走到這裡的是查認領紀錄或寫入結果的失敗
          logger.error('[AutomationWorker] Sentiment analysis failed, will retry:', err);
          failures.push(err);
        }
      }

      // 關鍵字規則由 workers 評估這個 job 時一併比對（design 決策 9）；入站訊息 id 供 keyword_matched 認領
      try {
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
        logger.error('[AutomationWorker] Failed to enqueue message.received, will retry:', err);
        failures.push(err);
      }

      // 加入好友另外以 contact.followed 評估（design D28）：帶回覆權杖與收到時間，動作在期限內用回覆方式送出。
      // job id 與 message.received 不同（BullMQ 的 job id 不能含「:」）；事件 id 相同，規則動作仍以
      // <事件 id, 規則 id#序號> 認領，兩個事件的規則不同，不會互相擋到
      if (isFollow) {
        try {
          await enqueueEvaluate(
            event,
            'contact.followed',
            { contactId, conversationId, messageId, channelType, replyToken, receivedAt, isFirstFollow: isFirstFollow === true },
            `${event.id}-followed`,
          );
        } catch (err) {
          logger.error('[AutomationWorker] Failed to enqueue contact.followed, will retry:', err);
          failures.push(err);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `message.received 有 ${failures.length} 個步驟失敗`);
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
      // 重試時，轉接、機器人回覆與情緒分析都已認領，不會重複
      throw err;
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
