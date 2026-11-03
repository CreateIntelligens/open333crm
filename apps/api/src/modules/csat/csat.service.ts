import type { Prisma, PrismaClient } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Server as SocketIOServer } from 'socket.io';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import { createAndDispatch } from '../notification/notification.service.js';
import { eventBus } from '../../events/event-bus.js';
import { emitToChannel } from '../../events/socket-push.js';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { prepareStoredMessageContent } from '../ai/deidentification.service.js';

/**
 * Build CSAT channel-specific message payload for LINE / FB / WEBCHAT.
 */
export function buildCsatChannelMessage(
  channelType: string,
  caseId: string,
): { contentType: string; content: Record<string, unknown> } {
  const question = '感謝您的耐心等候！請評價此次服務體驗（1-5 分）';

  if (channelType === CHANNEL_TYPE.LINE) {
    // LINE Flex Message with postback buttons
    return {
      contentType: 'flex',
      content: {
        type: 'flex',
        altText: question,
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '滿意度調查', weight: 'bold', size: 'lg' },
              { type: 'text', text: question, wrap: true, margin: 'md', size: 'sm' },
            ],
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [1, 2, 3, 4, 5].map((score) => ({
              type: 'button',
              action: {
                type: 'postback',
                label: `${score}`,
                data: `csat:${score}:${caseId}`,
                displayText: `我的評分：${score} 分`,
              },
              style: 'secondary',
              height: 'sm',
            })),
          },
        },
      },
    };
  }

  // FB / WEBCHAT: Quick Reply style (sent as text with structured buttons)
  return {
    contentType: 'quick_reply',
    content: {
      text: question,
      quickReplies: [1, 2, 3, 4, 5].map((score) => ({
        contentType: 'text',
        title: `${'★'.repeat(score)}${'☆'.repeat(5 - score)} ${score}分`,
        payload: `csat:${score}:${caseId}`,
      })),
    },
  };
}

/**
 * Send CSAT survey for a resolved case.
 */
export async function sendCsatSurvey(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
): Promise<boolean> {
  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      conversations: {
        include: { channel: true },
        take: 1,
      },
    },
  });

  if (!caseRecord) return false;
  if (caseRecord.status !== 'RESOLVED') return false;
  if (caseRecord.csatSentAt) return false; // already sent
  const conversation = caseRecord.conversations[0];
  const conversationId = conversation?.id;
  if (!conversationId) return false;

  const now = new Date();

  // 先以條件更新認領工單再寄出：job 重跑、兩期重疊，或讀取後工單被重開時，只有認領成功的一次會寄
  const { count } = await prisma.case.updateMany({
    where: { id: caseId, tenantId: caseRecord.tenantId, status: 'RESOLVED', csatSentAt: null },
    data: { csatSentAt: now },
  });
  if (count === 0) {
    logger.info(`[CsatService] Skip CSAT survey for case ${caseId}: already sent or no longer RESOLVED`);
    return false;
  }

  // Create CSAT system message in conversation
  const storedCsat = await prepareStoredMessageContent(prisma, caseRecord.tenantId, { text: '滿意度調查', caseId }, 'system_template');
  const csatMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'csat',
      content: storedCsat.content,
      metadata: { type: 'csat_survey', caseId, ...storedCsat.metadata },
      isRead: true,
      createdAt: now,
    },
  });

  // Update conversation lastMessageAt
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now },
  });

  // Emit WebSocket
  const wsPayload = {
    conversationId,
    message: {
      id: csatMessage.id,
      conversationId: csatMessage.conversationId,
      direction: csatMessage.direction,
      senderType: csatMessage.senderType,
      contentType: csatMessage.contentType,
      content: csatMessage.content as Record<string, unknown>,
      createdAt: csatMessage.createdAt.toISOString(),
      sender: null,
    },
  };
  emitToChannel(io, caseRecord.tenantId, { channelId: conversation.channelId, conversationId }, 'message.new', wsPayload);

  // Deliver to external channel
  // 送不出時 failureReason 是給客服看的原因；認領之後最多寄一次，失敗不還原 csatSentAt、不自動重寄（issue #416）
  let failureReason: string | null = null;
  try {
    const channelType = conversation.channelType;
    const csatPayload = buildCsatChannelMessage(channelType, caseId);

    // For LINE, we need to send the Flex message via plugin directly
    if (channelType === CHANNEL_TYPE.LINE) {
      const channel = conversation.channel;
      const identity = channel?.isActive
        ? await prisma.channelIdentity.findFirst({
            where: { contactId: caseRecord.contactId, channelId: channel.id },
          })
        : null;
      const plugin = getChannelPlugin(CHANNEL_TYPE.LINE);

      if (!channel?.isActive) {
        failureReason = '渠道已停用或不存在，問卷沒有送到客人';
      } else if (!identity) {
        failureReason = '找不到這位聯絡人在此渠道的帳號，問卷沒有送到客人';
      } else if (!plugin) {
        failureReason = '這個渠道類型目前無法從後台送出訊息';
      } else {
        const credentials = decryptCredentials(channel.credentialsEncrypted);
        const result = await plugin.sendMessage(identity.uid, csatPayload, credentials);
        if (!result.success) {
          failureReason = (result.error || 'LINE 沒有接受這份問卷').slice(0, 500);
        }
      }
    } else {
      // FB / WEBCHAT: fallback to text-based CSAT
      const delivered = await deliverToChannel(
        prisma,
        conversationId,
        '感謝您的耐心等候！請評價此次服務體驗（1-5 分），回覆 csat:分數 即可，例如 csat:5',
      );
      if (!delivered) failureReason = '問卷沒有送到客人，請確認渠道設定';
    }
  } catch (err) {
    logger.error('[CsatService] Channel delivery error:', err);
    failureReason = '問卷沒有送到客人，請確認渠道設定';
  }

  if (failureReason) {
    logger.warn(`[CsatService] CSAT survey for case ${caseId} not delivered: ${failureReason}`);
    const metadata = await recordCsatDeliveryFailure(
      { tx: prisma as TenantCtx['tx'], tenantId: caseRecord.tenantId },
      { caseId, messageId: csatMessage.id, messageMetadata: csatMessage.metadata, reason: failureReason },
    );
    // 再推一次 message.new：聊天視窗重新載入，問卷卡片顯示「沒有送出」
    emitToChannel(io, caseRecord.tenantId, { channelId: conversation.channelId, conversationId }, 'message.new', {
      ...wsPayload,
      message: { ...wsPayload.message, metadata },
    });
    return true;
  }

  logger.info(`[CsatService] CSAT survey sent for case ${caseId}`);
  return true;
}

/**
 * 滿意度問卷沒有送到客人時，留下客服看得到的紀錄（issue #416）：
 * - 問卷訊息的 metadata 標 `deliveryFailed` 與原因：收件匣的問卷卡片與對話列表顯示「沒有送出」。
 * - 工單時間軸寫一筆 `csat_send_failed`。
 * 回傳更新後的 metadata，讓呼叫端推播給聊天視窗。
 */
export async function recordCsatDeliveryFailure(
  ctx: TenantCtx,
  input: { caseId: string; messageId: string; messageMetadata: unknown; reason: string },
): Promise<Record<string, unknown>> {
  const base = input.messageMetadata && typeof input.messageMetadata === 'object' && !Array.isArray(input.messageMetadata)
    ? (input.messageMetadata as Record<string, unknown>)
    : {};
  const metadata = { ...base, deliveryFailed: true, deliveryError: input.reason };
  await ctx.tx.message.update({
    where: { id: input.messageId },
    data: { metadata: metadata as Prisma.InputJsonValue },
  });
  await ctx.tx.caseEvent.create({
    data: {
      caseId: input.caseId,
      actorType: 'system',
      eventType: 'csat_send_failed',
      payload: { reason: input.reason, messageId: input.messageId },
    },
  });
  return metadata;
}

/**
 * Get follow-up message based on CSAT score.
 */
function getFollowUpMessage(score: number): string {
  if (score <= 2) {
    return '非常抱歉讓您感到不滿意，我們會立即安排主管為您跟進處理，請您稍候。';
  }
  if (score === 3) {
    return '感謝您的回饋！我們會持續改善服務品質，期待下次能為您提供更好的體驗。';
  }
  return '非常感謝您的好評！您的肯定是我們最大的動力，期待再次為您服務！';
}

/**
 * 誰可以替這張工單評分：
 * - tenantId：工單必須屬於這個租戶。
 * - contactId：給了就必須是工單的聯絡人（進站評分）；客服操作不給。
 */
export interface CsatScope {
  tenantId: string;
  contactId?: string;
}

/**
 * Record CSAT score and handle follow-up actions.
 */
export async function recordCsatScore(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
  score: number,
  comment: string | undefined,
  scope: CsatScope,
): Promise<boolean> {
  // 進站管線用 prismaAdmin（BYPASSRLS），租戶與聯絡人只能靠這裡的條件擋（AUDIT RLS-06）
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId: scope.tenantId, contactId: scope.contactId },
    include: {
      conversations: {
        select: { id: true, channelId: true },
        take: 1,
      },
    },
  });

  if (!caseRecord) return false;
  if (caseRecord.csatScore !== null) return false; // already rated
  if (score < 1 || score > 5) return false;

  const now = new Date();
  const conversation = caseRecord.conversations[0];
  const conversationId = conversation?.id;

  // Update case with CSAT data
  await prisma.case.update({
    where: { id: caseId },
    data: {
      csatScore: score,
      csatComment: comment ?? null,
      csatRespondedAt: now,
    },
  });

  // Send follow-up message
  const followUp = getFollowUpMessage(score);

  if (conversation && conversationId) {
    const storedFollowUp = await prepareStoredMessageContent(prisma, scope.tenantId, { text: followUp }, 'system_template');
    // Create follow-up message in conversation
    const followUpMsg = await prisma.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType: 'text',
        content: storedFollowUp.content,
        metadata: { type: 'csat_followup', csatScore: score, ...storedFollowUp.metadata },
        isRead: true,
        createdAt: now,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    });

    // Emit WebSocket
    const wsPayload = {
      conversationId,
      message: {
        id: followUpMsg.id,
        conversationId: followUpMsg.conversationId,
        direction: followUpMsg.direction,
        senderType: followUpMsg.senderType,
        contentType: followUpMsg.contentType,
        content: followUpMsg.content as Record<string, unknown>,
        createdAt: followUpMsg.createdAt.toISOString(),
        sender: null,
      },
    };
    emitToChannel(io, caseRecord.tenantId, { channelId: conversation.channelId, conversationId }, 'message.new', wsPayload);

    // Deliver follow-up to channel
    deliverToChannel(prisma, conversationId, followUp).catch(() => {});
  }

  // Low score: notify supervisor
  if (score <= 2) {
    try {
      const supervisors = await prisma.agent.findMany({
        where: { tenantId: caseRecord.tenantId, role: 'SUPERVISOR', isActive: true },
      });

      for (const supervisor of supervisors) {
        await createAndDispatch(prisma, io, {
          tenantId: caseRecord.tenantId,
          agentId: supervisor.id,
          type: 'csat_low_score',
          title: 'CSAT 低分警報',
          body: `案件「${caseRecord.title}」收到 ${score} 分評價，請關注處理。`,
          clickUrl: `/dashboard/cases?id=${caseId}`,
        });
      }
    } catch (err) {
      logger.error('[CsatService] Failed to notify supervisors:', err);
    }
  }

  // Auto-close the case
  try {
    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: 'CLOSED',
        closedAt: now,
      },
    });

    // Publish case.closed event
    eventBus.publish({
      name: 'case.closed',
      tenantId: caseRecord.tenantId,
      timestamp: now,
      payload: {
        caseId,
        contactId: caseRecord.contactId,
        channelId: caseRecord.channelId,
        conversationId,
        assigneeId: caseRecord.assigneeId,
        title: caseRecord.title,
        csatScore: score,
      },
    });

    // Emit case.updated via WebSocket
    io.to(`tenant:${caseRecord.tenantId}`).emit('case.updated', {
      id: caseId,
      status: 'CLOSED',
      priority: caseRecord.priority,
      assigneeId: caseRecord.assigneeId,
    });
  } catch (err) {
    logger.error('[CsatService] Failed to close case after CSAT:', err);
  }

  logger.info(`[CsatService] CSAT recorded for case ${caseId}: score=${score}`);
  return true;
}
