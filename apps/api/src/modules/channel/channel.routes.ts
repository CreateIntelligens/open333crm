import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listChannels,
  createChannel,
  getChannel,
  updateChannel,
  deleteChannel,
  verifyChannel,
  updateWebhookBaseUrl,
} from './channel.service.js';
import { success } from '../../shared/utils/response.js';

const lineCredentialsSchema = z.object({
  channelSecret: z.string().min(1),
  channelAccessToken: z.string().min(1),
});

const fbCredentialsSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().min(1),
  pageAccessToken: z.string().min(1),
  pageId: z.string().optional(),
});

const webchatCredentialsSchema = z.record(z.unknown());

const createChannelSchema = z.object({
  channelType: z.enum(['LINE', 'FB', 'WEBCHAT', 'WHATSAPP']),
  displayName: z.string().min(1).max(100),
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
  webhookBaseUrl: z.string().url().optional(),
}).superRefine((data, ctx) => {
  if (data.channelType === 'LINE') {
    const result = lineCredentialsSchema.safeParse(data.credentials);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        ctx.addIssue({ ...issue, path: ['credentials', ...issue.path] });
      });
    }
  } else if (data.channelType === 'FB') {
    const result = fbCredentialsSchema.safeParse(data.credentials);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        ctx.addIssue({ ...issue, path: ['credentials', ...issue.path] });
      });
    }
  }
});

const updateWebhookBaseUrlSchema = z.object({
  baseUrl: z.string().min(1),
});

const updateChannelSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

export default async function channelRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/channels
  fastify.get('/', async (request, reply) => {
    const channels = await listChannels(fastify.prisma, request.agent.tenantId);
    return reply.send(success(channels));
  });

  // POST /api/v1/channels
  fastify.post('/', async (request, reply) => {
    const data = createChannelSchema.parse(request.body);

    const channel = await createChannel(fastify.prisma, request.agent.tenantId, data);

    return reply.status(201).send(success(channel));
  });

  // GET /api/v1/channels/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const channel = await getChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(channel));
  });

  // PATCH /api/v1/channels/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateChannelSchema.parse(request.body);

    const channel = await updateChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(channel));
  });

  // DELETE /api/v1/channels/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const result = await deleteChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(result));
  });

  // POST /api/v1/channels/:id/verify
  fastify.post<{ Params: { id: string } }>('/:id/verify', async (request, reply) => {
    const result = await verifyChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(result));
  });

  // POST /api/v1/channels/webhook-base-url — 批次更新所有渠道的 Webhook URL
  fastify.post('/webhook-base-url', async (request, reply) => {
    const data = updateWebhookBaseUrlSchema.parse(request.body);

    const result = await updateWebhookBaseUrl(
      fastify.prisma,
      request.agent.tenantId,
      data.baseUrl,
    );

    return reply.send(success(result));
  });
}
