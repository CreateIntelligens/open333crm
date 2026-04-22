import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
  updateConversation,
  handoffConversation,
} from './conversation.service.js';
import { createCaseFromConversation } from '../case/case.service.js';
import { success, paginated, AppError } from '../../shared/utils/response.js';
import { uploadFile } from '../storage/storage.service.js';

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
  allowedChannelTypes: ['LINE', 'FB'],
};

const SEND_VIDEO_CONFIG: MediaUploadConfig = {
  allowedMimes: ['video/mp4', 'video/quicktime'],
  maxBytes: 25 * 1024 * 1024,
  contentType: 'video',
  displayText: '[影片]',
  allowedChannelTypes: ['LINE', 'FB'],
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

  const conversationId = request.params.id;
  const { tenantId, id: agentId } = (request as any).agent;

  const conversation = await fastify.prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true },
  });

  if (!conversation || conversation.tenantId !== tenantId) {
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  const channelType = conversation.channel?.channelType ?? '';
  if (!config.allowedChannelTypes.includes(channelType)) {
    return reply.status(501).send({
      code: 'NOT_IMPLEMENTED',
      message: `${config.contentType} push not yet supported for this channel type`,
    });
  }

  const uploaded = await uploadFile(buffer, file.filename, file.mimetype, tenantId, 'media', conversationId);

  const { message, delivery } = await sendMessage(
    fastify.prisma,
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

    const { conversations, total } = await listConversations(
      fastify.prisma,
      request.agent.tenantId,
      filters,
      { page, limit },
    );

    return reply.send(paginated(conversations, total, page, limit));
  });

  // GET /api/v1/conversations/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const conversation = await getConversation(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(conversation));
  });

  // PATCH /api/v1/conversations/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateConversationSchema.parse(request.body);

    const conversation = await updateConversation(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(conversation));
  });

  // GET /api/v1/conversations/:id/messages
  fastify.get<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
    const query = messagesQuerySchema.parse(request.query);

    const { messages, total } = await getMessages(
      fastify.prisma,
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

    const { message } = await sendMessage(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.id,
      request.agent.tenantId,
      data,
    );

    return reply.status(201).send(success(message));
  });

  // POST /api/v1/conversations/:id/handoff - handoff from bot to agent
  fastify.post<{ Params: { id: string } }>('/:id/handoff', async (request, reply) => {
    const data = z.object({
      assignToId: z.string().uuid().optional(),
      handoffMessage: z.string().optional(),
    }).parse(request.body);

    const conversation = await handoffConversation(
      fastify.prisma,
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
