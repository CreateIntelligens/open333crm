import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  broadcastMessage,
} from './marketing.service.js';
import { success, paginated } from '../../shared/utils/response.js';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  channelType: z.string().max(50).optional(),
  contentType: z.enum(['text', 'image', 'template']).optional(),
  body: z.record(z.unknown()),
  variables: z.array(z.unknown()).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  channelType: z.string().max(50).optional(),
  contentType: z.enum(['text', 'image', 'template']).optional(),
  body: z.record(z.unknown()).optional(),
  variables: z.array(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const broadcastSchema = z.object({
  templateId: z.string().uuid(),
  channelId: z.string().uuid(),
  targetType: z.enum(['all', 'tags', 'contacts']),
  tagIds: z.array(z.string().uuid()).optional(),
  contactIds: z.array(z.string().uuid()).optional(),
});

export default async function marketingRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/marketing/templates — 範本列表
  fastify.get('/templates', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listTemplates(fastify.prisma, request.agent.tenantId, {
      category: query.category || undefined,
      channelType: query.channelType || undefined,
      q: query.q || undefined,
      page,
      limit,
    });

    return reply.send(paginated(result.templates, result.total, result.page, result.limit));
  });

  // POST /api/v1/marketing/templates — 新建範本
  fastify.post('/templates', async (request, reply) => {
    const data = createTemplateSchema.parse(request.body);
    const template = await createTemplate(fastify.prisma, request.agent.tenantId, data);
    return reply.status(201).send(success(template));
  });

  // GET /api/v1/marketing/templates/:id — 範本詳情
  fastify.get<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
    const template = await getTemplate(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(template));
  });

  // PATCH /api/v1/marketing/templates/:id — 更新範本
  fastify.patch<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
    const data = updateTemplateSchema.parse(request.body);
    const template = await updateTemplate(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(template));
  });

  // DELETE /api/v1/marketing/templates/:id — 刪除範本
  fastify.delete<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
    const result = await deleteTemplate(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/marketing/broadcast — 群發訊息
  fastify.post('/broadcast', async (request, reply) => {
    const data = broadcastSchema.parse(request.body);
    const stats = await broadcastMessage(
      fastify.prisma,
      fastify.io,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.send(success(stats));
  });
}
