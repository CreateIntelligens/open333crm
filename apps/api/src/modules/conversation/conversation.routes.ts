import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CHANNEL_TYPE } from '@open333crm/shared';
import {
  listConversations,
  getConversation,
  getMessages,
  markConversationRead,
  sendMessage,
  updateConversation,
  closeConversation,
  handoffConversation,
} from './conversation.service.js';
import { createCaseFromConversation } from '../case/case.service.js';
import { addTagToTarget, removeTagFromTarget } from '../tag/tagging.service.js';
import { success, paginated, AppError } from '../../shared/utils/response.js';
import { resolveChannelVisibility, isChannelAccessible, assertConversationChannelVisible } from '../../services/channel-visibility.js';
import { withTenant } from '../../lib/tenant-db.js';
import { uploadFile } from '../storage/storage.service.js';
import { assertUploadContent } from '../upload/upload-validation.js';
import { UPLOAD_POLICIES } from '../upload/upload-content-detector.js';

interface MediaUploadConfig {
  allowedMimes: readonly string[];
  maxBytes: number;
  contentType: 'image' | 'video';
  displayText: string;
  allowedChannelTypes: readonly string[];
}

const SEND_IMAGE_CONFIG: MediaUploadConfig = {
  allowedMimes: ['image/png', 'image/jpeg'],
  maxBytes: 20 * 1024 * 1024,
  contentType: 'image',
  displayText: '[圖片]',
  allowedChannelTypes: [CHANNEL_TYPE.LINE, CHANNEL_TYPE.FB, CHANNEL_TYPE.WEBCHAT],
};

const SEND_VIDEO_CONFIG: MediaUploadConfig = {
  allowedMimes: ['video/mp4', 'video/quicktime'],
  maxBytes: 25 * 1024 * 1024,
  contentType: 'video',
  displayText: '[影片]',
  allowedChannelTypes: [CHANNEL_TYPE.LINE, CHANNEL_TYPE.FB, CHANNEL_TYPE.WEBCHAT],
};

async function handleSendMedia(
  fastify: FastifyInstance,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  config: MediaUploadConfig,
): Promise<unknown> {
  const file = await request.file();
  if (!file) throw new AppError('No file uploaded', 'BAD_REQUEST', 400);

  if (!config.allowedMimes.includes(file.mimetype)) {
    throw new AppError(`Unsupported file type. Allowed: ${config.allowedMimes.join(', ')}`, 'BAD_REQUEST', 400);
  }

  const buffer = await file.toBuffer();
  if (buffer.length > config.maxBytes) {
    throw new AppError(`File exceeds ${Math.round(config.maxBytes / 1024 / 1024)} MB limit`, 'BAD_REQUEST', 400);
  }

  const detected = await assertUploadContent(
    { buffer, filename: file.filename, clientMime: file.mimetype },
    config.contentType === 'image' ? UPLOAD_POLICIES.conversationImage : UPLOAD_POLICIES.conversationVideo,
  );
  const detectedMime = detected.detectedMime ?? file.mimetype;

  const conversationId = request.params.id;
  const { tenantId, id: agentId } = (request as any).agent;

  const conversation = await request.tenantPrisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true },
  });

  if (!conversation || conversation.tenantId !== tenantId) {
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  // CM-173：送媒體屬回覆類操作，需 reply_only 以上（渠道不可見或層級不足 → 403）
  await assertConversationChannelVisible(request, conversationId, 'reply_only');

  const channelType = conversation.channel?.channelType ?? '';
  if (!config.allowedChannelTypes.includes(channelType)) {
    return reply.status(501).send({
      code: 'NOT_IMPLEMENTED',
      message: `${config.contentType} push not yet supported for this channel type`,
    });
  }

  const uploaded = await uploadFile(buffer, file.filename, detectedMime, tenantId, 'media', conversationId);

  const { message, delivery } = await sendMessage(
    request.tenantPrisma,
    fastify.io,
    conversationId,
    agentId,
    tenantId,
    {
      contentType: config.contentType,
      content: {
        url: uploaded.url,
        mediaUrl: uploaded.url,
        text: config.displayText,
        storageKey: uploaded.key,
      },
    },
  );

  return reply.status(201).send(success({ ...message, delivery }));
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  channelType: z.string().optional(),
  assigneeId: z.string().optional(),
  unread: z.coerce.boolean().optional(),
  closedAfter: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const updateConversationSchema = z.object({
  status: z.enum(['ACTIVE', 'BOT_HANDLED', 'AGENT_HANDLED', 'CLOSED']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

const sendMessageSchema = z.object({
  contentType: z.string().default('text'),
  content: z.record(z.unknown()),
});

const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

const messagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const createCaseFromConvSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export default async function conversationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/conversations
  fastify.get('/', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    // CM-173 渠道級可見性：只回當前 agent 可見渠道的對話（總店 view_all 不過濾）
    const accessible = await resolveChannelVisibility(request);

    const { conversations, total } = await listConversations(
      request.tenantPrisma,
      request.agent.tenantId,
      filters,
      { page, limit },
      accessible,
    );

    return reply.send(paginated(conversations, total, page, limit));
  });

  // GET /api/v1/conversations/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const conversation = await getConversation(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );

    // 查無此對話（或非本租戶）→ 404，避免下方存取 channelId 觸發 500
    if (!conversation) {
      throw new AppError('Conversation not found', 'NOT_FOUND', 404);
    }

    // CM-173：渠道不在可見集合 → 視為不存在（404），不洩漏他店資料
    const accessible = await resolveChannelVisibility(request);
    if (!isChannelAccessible(accessible, conversation.channelId)) {
      throw new AppError('Conversation not found', 'NOT_FOUND', 404);
    }

    return reply.send(success(conversation));
  });

  // PATCH /api/v1/conversations/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateConversationSchema.parse(request.body);
    await assertConversationChannelVisible(request, request.params.id, 'full'); // CM-173：改狀態/指派為管理操作

    const conversation = await updateConversation(
      request.tenantPrisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(conversation));
  });

  // POST /api/v1/conversations/:id/read
  fastify.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    await assertConversationChannelVisible(request, request.params.id, 'read_only'); // CM-173：渠道不可見不得改已讀狀態
    const conversation = await markConversationRead(
      request.tenantPrisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(conversation));
  });

  // POST /api/v1/conversations/:id/tags
  fastify.post<{ Params: { id: string } }>('/:id/tags', async (request, reply) => {
    const body = addTagSchema.parse(request.body);
    await assertConversationChannelVisible(request, request.params.id); // CM-173
    const conversationTag = await addTagToTarget(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      targetType: 'CONVERSATION',
      targetId: request.params.id,
      tagId: body.tagId,
      agentId: request.agent.id,
    });

    return reply.status(201).send(success(conversationTag));
  });

  // DELETE /api/v1/conversations/:id/tags/:tagId
  fastify.delete<{ Params: { id: string; tagId: string } }>(
    '/:id/tags/:tagId',
    async (request, reply) => {
      await assertConversationChannelVisible(request, request.params.id); // CM-173
      const removed = await removeTagFromTarget(request.tenantPrisma, {
        tenantId: request.agent.tenantId,
        targetType: 'CONVERSATION',
        targetId: request.params.id,
        tagId: request.params.tagId,
      });

      return reply.send(success(removed));
    },
  );

  // GET /api/v1/conversations/:id/messages
  fastify.get<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
    const query = messagesQuerySchema.parse(request.query);
    await assertConversationChannelVisible(request, request.params.id, 'read_only'); // CM-173：渠道不可見不得讀訊息歷史

    const { messages, total } = await getMessages(
      request.tenantPrisma,
      request.params.id,
      query.page,
      query.limit,
      query.order,
    );

    return reply.send(paginated(messages, total, query.page, query.limit));
  });

  // POST /api/v1/conversations/:id/messages
  fastify.post<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
    const data = sendMessageSchema.parse(request.body);
    await assertConversationChannelVisible(request, request.params.id); // CM-173

    const { message } = await sendMessage(
      request.tenantPrisma,
      fastify.io,
      request.params.id,
      request.agent.id,
      request.agent.tenantId,
      data,
    );

    return reply.status(201).send(success(message));
  });

  // POST /api/v1/conversations/:id/close - close conversation with optional reason
  fastify.post<{ Params: { id: string } }>('/:id/close', async (request, reply) => {
    const data = z.object({
      reason: z.string().max(1000).optional(),
    }).parse(request.body ?? {});
    await assertConversationChannelVisible(request, request.params.id, 'full'); // CM-173：關閉為管理操作

    const conversation = await closeConversation(
      request.tenantPrisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      {
        reason: data.reason,
        source: 'manual',
        closedById: request.agent.id,
      },
    );

    return reply.send(success(conversation));
  });

  // POST /api/v1/conversations/:id/handoff - handoff from bot to agent
  fastify.post<{ Params: { id: string } }>('/:id/handoff', async (request, reply) => {
    const data = z.object({
      assignToId: z.string().uuid().optional(),
      handoffMessage: z.string().optional(),
    }).parse(request.body);
    await assertConversationChannelVisible(request, request.params.id, 'full'); // CM-173：轉接為管理操作

    const conversation = await handoffConversation(
      request.tenantPrisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      data,
    );

    return reply.send(success(conversation));
  });

  // POST /api/v1/conversations/:id/typing - emit typing event
  fastify.post<{ Params: { id: string } }>('/:id/typing', async (request, reply) => {
    const { action } = z.object({
      action: z.enum(['start', 'stop']),
    }).parse(request.body);
    await assertConversationChannelVisible(request, request.params.id, 'reply_only'); // CM-173：typing 伴隨回覆行為，渠道需達 reply_only

    const conversationId = request.params.id;
    const event = action === 'start' ? 'typing.start' : 'typing.stop';
    fastify.io.to(`conversation:${conversationId}`).emit(event, {
      conversationId,
      agentId: request.agent.id,
    });

    return reply.send(success({ ok: true }));
  });

  // POST /api/v1/conversations/:id/case - create case from conversation
  fastify.post<{ Params: { id: string } }>('/:id/case', async (request, reply) => {
    const data = createCaseFromConvSchema.parse(request.body);
    await assertConversationChannelVisible(request, request.params.id, 'full'); // CM-173：建工單為管理操作

    // createCaseFromConversation 內部自管交易（DB 寫入 withTenant，副作用交易外）
    const caseRecord = await createCaseFromConversation(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      data,
    );

    return reply.status(201).send(success(caseRecord));
  });

  // POST /api/v1/conversations/:id/send-image
  fastify.post<{ Params: { id: string } }>('/:id/send-image', (request, reply) =>
    handleSendMedia(fastify, request, reply, SEND_IMAGE_CONFIG),
  );

  // POST /api/v1/conversations/:id/send-video
  fastify.post<{ Params: { id: string } }>('/:id/send-video', (request, reply) =>
    handleSendMedia(fastify, request, reply, SEND_VIDEO_CONFIG),
  );
}
