import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import { createAndDispatch } from '../notification/notification.service.js';
import { eventBus } from '../../events/event-bus.js';

/**
 * Build CSAT channel-specific message payload for LINE / FB / WEBCHAT.
 */
export function buildCsatChannelMessage(
  channelType: string,
  caseId: string,
): { contentType: string; content: Record<string, unknown> } {
  const question = '感謝您的耐心等候！請評價此次服務體驗（1-5 分）';

  if (channelType === 'LINE') {
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
  prisma: PrismaClient,
  io: SocketIOServer,
  caseId: string,
): Promise<boolean> {
  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      conversation: { include: { channel: true } },
    },
  });

  if (!caseRecord) return false;
  if (caseRecord.status !== 'RESOLVED') return false;
  if (caseRecord.csatSentAt) return false; // already sent
  if (!caseRecord.conversationId) return false;

  const conversation = caseRecord.conversation;
  if (!conversation) return false;

  const now = new Date();

  // Create CSAT system message in conversation
  const csatMessage = await prisma.message.create({
    data: {
      conversationId: caseRecord.conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'csat',
      content: { text: '滿意度調查', caseId },
      metadata: { type: 'csat_survey', caseId },
      isRead: true,
      createdAt: now,
    },
  });

  // Update csatSentAt
  await prisma.case.update({
    where: { id: caseId },
    data: { csatSentAt: now },
  });

  // Update conversation lastMessageAt
  await prisma.conversation.update({
    where: { id: caseRecord.conversationId },
    data: { lastMessageAt: now },
  });

  // Emit WebSocket
  const wsPayload = {
    conversationId: caseRecord.conversationId,
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
  io.to(`conversation:${caseRecord.conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${caseRecord.tenantId}`).emit('message.new', wsPayload);

  // Deliver to external channel
  try {
    const channelType = conversation.channelType;
    const csatPayload = buildCsatChannelMessage(channelType, caseId);

    // For LINE, we need to send the Flex message via plugin directly
    if (channelType === 'LINE' && conversation.channel?.isActive) {
      const channel = conversation.channel;
      const identity = await prisma.channelIdentity.findFirst({
        where: { contactId: caseRecord.contactId, channelId: channel.id },
      });

      if (identity) {
        const plugin = getChannelPlugin('LINE');
        if (plugin) {
          const credentials = decryptCredentials(channel.credentialsEncrypted);
          // Send Flex message (LINE plugin sendMessage handles it as raw JSON)
          await plugin.sendMessage(identity.uid, csatPayload, credentials);
        }
      }
    } else {
      // FB / WEBCHAT: fallback to text-based CSAT
      await deliverToChannel(
        prisma,
        caseRecord.conversationId,
        '感謝您的耐心等候！請評價此次服務體驗（1-5 分），回覆 csat:分數 即可，例如 csat:5',
      );
    }
  } catch (err) {
    console.error('[CsatService] Channel delivery error:', err);
  }

  console.log(`[CsatService] CSAT survey sent for case ${caseId}`);
  return true;
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
 * Record CSAT score and handle follow-up actions.
 */
export async function recordCsatScore(
  prisma: PrismaClient,
  io: SocketIOServer,
  caseId: string,
  score: number,
  comment?: string,
): Promise<boolean> {
  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
  });

  if (!caseRecord) return false;
  if (caseRecord.csatScore !== null) return false; // already rated
  if (score < 1 || score > 5) return false;

  const now = new Date();

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

  if (caseRecord.conversationId) {
    // Create follow-up message in conversation
    const followUpMsg = await prisma.message.create({
      data: {
        conversationId: caseRecord.conversationId,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType: 'text',
        content: { text: followUp },
        metadata: { type: 'csat_followup', csatScore: score },
        isRead: true,
        createdAt: now,
      },
    });

    await prisma.conversation.update({
      where: { id: caseRecord.conversationId },
      data: { lastMessageAt: now },
    });

    // Emit WebSocket
    const wsPayload = {
      conversationId: caseRecord.conversationId,
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
    io.to(`conversation:${caseRecord.conversationId}`).emit('message.new', wsPayload);
    io.to(`tenant:${caseRecord.tenantId}`).emit('message.new', wsPayload);

    // Deliver follow-up to channel
    deliverToChannel(prisma, caseRecord.conversationId, followUp).catch(() => {});
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
      console.error('[CsatService] Failed to notify supervisors:', err);
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
        conversationId: caseRecord.conversationId,
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
    console.error('[CsatService] Failed to close case after CSAT:', err);
  }

  console.log(`[CsatService] CSAT recorded for case ${caseId}: score=${score}`);
  return true;
}
