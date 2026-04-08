import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateAuthUrl,
  validateState,
  exchangeCodeForToken,
  getUserEmail,
  updateContactEmail,
} from './fb-login.service.js';
import { getChannelPlugin } from '@open333crm/channel-plugins/webhook';
import { decryptCredentials } from '../channel/channel.service.js';
import { success } from '../../shared/utils/response.js';

export default async function fbLoginRoutes(fastify: FastifyInstance) {
  // ─── GET /authorize ── Public: returns the Facebook Login OAuth URL ──────
  fastify.get<{
    Querystring: { psid: string; channelId: string };
  }>('/authorize', async (request, reply) => {
    const { psid, channelId } = z
      .object({
        psid: z.string().min(1),
        channelId: z.string().uuid(),
      })
      .parse(request.query);

    const url = generateAuthUrl(psid, channelId);
    return reply.send(success({ url }));
  });

  // ─── GET /callback ── Public: Facebook Login OAuth callback ──────────────
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string; error_reason?: string };
  }>('/callback', async (request, reply) => {
    const { code, state, error } = request.query;

    const frontendBase = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000';
    const resultPage = `${frontendBase}/fb-login/result`;

    // User cancelled or Facebook returned an error
    if (error || !code || !state) {
      return reply.redirect(`${resultPage}?status=cancelled`);
    }

    // Validate state
    const stateData = validateState(state);
    if (!stateData) {
      return reply.redirect(`${resultPage}?status=error&reason=invalid_state`);
    }

    try {
      // Exchange code for access token
      const { accessToken } = await exchangeCodeForToken(code);

      // Get user email
      const { email } = await getUserEmail(accessToken);

      if (!email) {
        fastify.log.warn('Facebook Login: no email returned');
        return reply.redirect(`${resultPage}?status=no_email`);
      }

      // Update Contact email in DB
      const result = await updateContactEmail(
        fastify.prisma,
        stateData.psid,
        email,
        stateData.channelId,
      );

      fastify.log.info(
        { contactId: result.contactId, email },
        'Facebook Login: contact email updated',
      );

      return reply.redirect(`${resultPage}?status=success`);
    } catch (err) {
      fastify.log.error({ err }, 'Facebook Login callback error');
      return reply.redirect(`${resultPage}?status=error`);
    }
  });

  // ─── POST /request-email ── JWT required: Agent triggers email request ───
  fastify.post<{
    Body: { conversationId: string };
  }>(
    '/request-email',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { conversationId } = z
        .object({ conversationId: z.string().uuid() })
        .parse(request.body);

      const tenantId = request.agent.tenantId;
      const agentId = request.agent.id;

      // 1. Load conversation with channel + contact identity
      const conversation = await fastify.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        include: {
          channel: true,
          contact: {
            include: {
              channelIdentities: true,
            },
          },
        },
      });

      if (!conversation) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
      }

      if (conversation.channelType !== 'FB') {
        return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: '此功能僅支援 Facebook 渠道' } });
      }

      // 2. Find the FB channel identity for this contact + channel
      const identity = conversation.contact?.channelIdentities?.find(
        (ci) => ci.channelId === conversation.channelId,
      );

      if (!identity) {
        return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: '找不到聯絡人的 Facebook 身份' } });
      }

      // 3. Generate the authorization URL
      const authUrl = generateAuthUrl(identity.uid, conversation.channelId);

      // 4. Send the link via Messenger Bot
      const channel = conversation.channel;
      if (!channel?.isActive) {
        return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Facebook 渠道未啟用' } });
      }

      const credentials = decryptCredentials(channel.credentialsEncrypted);
      const plugin = getChannelPlugin('FB');

      if (!plugin) {
        return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'FB plugin not found' } });
      }

      const messageText = '📧 您好！我們需要您的 Email 以便提供更完善的服務。\n\n請點擊以下連結完成授權：\n' + authUrl;

      const sendResult = await plugin.sendMessage(
        identity.uid,
        { contentType: 'text', content: { text: messageText } },
        credentials,
      );

      if (!sendResult.success) {
        fastify.log.error({ error: sendResult.error }, 'Failed to send FB email request message');
        return reply.status(502).send({ success: false, error: { code: 'CHANNEL_ERROR', message: '發送 Facebook 訊息失敗' } });
      }

      // 5. Record the outbound message in the conversation
      const now = new Date();
      const message = await fastify.prisma.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          senderId: agentId,
          contentType: 'text',
          content: { text: messageText },
          channelMsgId: sendResult.channelMsgId ?? null,
          metadata: { type: 'email_request' },
          isRead: true,
          createdAt: now,
        },
        include: {
          sender: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      });

      // Update conversation lastMessageAt
      await fastify.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });

      // 6. Emit WebSocket event so the message appears in real-time
      const wsPayload = {
        conversationId,
        message: {
          id: message.id,
          conversationId: message.conversationId,
          direction: message.direction,
          senderType: message.senderType,
          senderId: message.senderId,
          contentType: message.contentType,
          content: message.content as Record<string, unknown>,
          createdAt: message.createdAt.toISOString(),
          sender: (message as any).sender,
        },
      };

      fastify.io.to(`conversation:${conversationId}`).emit('message.new', wsPayload);
      fastify.io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

      return reply.status(201).send(success({ messageId: message.id }));
    },
  );
}
