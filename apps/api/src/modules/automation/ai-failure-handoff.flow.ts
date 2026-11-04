/**
 * AI 回覆與知識庫回覆都因錯誤失敗時轉接真人（issue #445，change handoff-on-ai-reply-failure-445：
 * bot-handoff-config「AI 與知識庫回覆都因錯誤失敗時轉接真人」「AI 失敗的轉接每則訊息最多一次」）。
 *
 * automation.worker 的 message.received 在知識庫自動回覆回傳 failed（或丟出認領以外的錯誤）時呼叫。
 * - 交易外：讀對話與 botConfig、讀租戶的遮罩設定。系統訊息是固定文字，不呼叫去識別化服務（它可能正是失敗的原因）。
 * - 交易內：以 bot_reply + 入站訊息 id 認領，再走 handOffConversation()（與自動轉接、KB 追問用完共用）。
 *   認領不到（這則訊息已有機器人回覆）或對話已不是 BOT_HANDLED 時整筆 rollback，不轉接。
 * - commit 之後送出渠道的轉接訊息；失敗只記 log，不重試（最多一次）。
 * commit 之前的失敗往外丟，由佇列重試整個 message.received。不寫對話摘要：摘要也要呼叫 LLM。
 * 沿用：handOffConversation()（轉接本身）、createBotReplyGuard()（claimSideEffect 的 bot_reply 認領）、
 * kb-autoreply.service 的轉接原因（aiReplyFailedReason，與 clarifyLlmFailedReason 共用錯誤種類判斷）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { getBotConfig } from '@open333crm/automation';
import { logger } from '@open333crm/core';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { readAiPrivacyPolicy } from '../platform/ai-privacy.service.js';
import { fixedSystemMessageContent } from '../ai/deidentification.service.js';
import { aiReplyFailedReason } from '../ai/kb-autoreply.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { createBotReplyGuard } from './bot-reply-guard.js';
import { handOffConversation } from './handoff.flow.js';

export interface AiFailureHandoffDeps {
  /** 交易外的查詢（admin 連線），查詢都自帶 tenantId */
  prisma: PrismaClient;
  /** inTenant() 的基礎連線（受 RLS 約束） */
  tenantPrisma: PrismaClient;
  io: Server;
  events: EventPublisher;
}

export interface AiFailureHandoffInput {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string | undefined;
  kbError: unknown;
  agentError?: unknown;
}

/** 回傳是否轉接（false：對話已不是 BOT_HANDLED，或這則訊息已有機器人回覆） */
export async function handOffAfterAiFailure(deps: AiFailureHandoffDeps, input: AiFailureHandoffInput): Promise<boolean> {
  const { prisma, tenantPrisma, io, events } = deps;
  const { tenantId, conversationId } = input;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
    select: { channelId: true, channel: { select: { settings: true } } },
  });
  if (!conversation) return false;
  const botConfig = getBotConfig(conversation.channel?.settings);

  const reason = aiReplyFailedReason(input.kbError, input.agentError);
  const privacy = await readAiPrivacyPolicy(prisma, tenantId);
  const stored = fixedSystemMessageContent({ text: `自動轉接人工客服：${reason}` }, privacy.enabled);
  const now = new Date();

  const replyGuard = createBotReplyGuard(tenantPrisma, prisma, tenantId, input.inboundMessageId);
  const handedOff = await replyGuard.persist((_tx, scope) =>
    handOffConversation(
      scope,
      { io, events },
      {
        conversationId,
        channelId: conversation.channelId,
        reason,
        now,
        systemContent: stored.content,
        systemMetadata: { type: 'auto_handoff', reason, source: 'ai_reply_failed', ...stored.metadata },
      },
    ),
  );
  if (!handedOff) return false;

  // 以下在轉接 commit 之後：失敗只記 log，不重試（轉接訊息最多送出一次）
  try {
    await deliverToChannel(prisma, conversationId, botConfig.handoffMessage);
  } catch (err) {
    logger.error('[AiFailureHandoff] 轉接之後送出轉接訊息失敗:', err);
  }
  logger.warn(`[AiFailureHandoff] conv=${conversationId} AI 與知識庫回覆都失敗，已轉接真人：${reason}`);
  return true;
}
