import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { AppError } from '../../shared/utils/response.js';

const createTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().default('#6366f1'),
  type: z.enum(['MANUAL', 'AUTO', 'SYSTEM', 'CHANNEL']),
  scope: z.enum(['CONTACT', 'CONVERSATION', 'CASE']),
  description: z.string().optional(),
});

const updateTagSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});

export default async function tagRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/tags
  fastify.get('/', async (request, reply) => {
    const tags = await fastify.prisma.tag.findMany({
      where: { tenantId: request.agent.tenantId },
      orderBy: [
        { scope: 'asc' },
        { name: 'asc' },
      ],
    });

    return reply.send(success(tags));
  });

  // POST /api/v1/tags
  fastify.post('/', async (request, reply) => {
    const data = createTagSchema.parse(request.body);

    const tag = await fastify.prisma.tag.create({
      data: {
        tenantId: request.agent.tenantId,
        name: data.name,
        color: data.color,
        type: data.type,
        scope: data.scope,
        description: data.description,
      },
    });

    return reply.status(201).send(success(tag));
  });

  // PATCH /api/v1/tags/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateTagSchema.parse(request.body);

    const tag = await fastify.prisma.tag.findFirst({
      where: { id: request.params.id, tenantId: request.agent.tenantId },
    });

    if (!tag) {
      throw new AppError('Tag not found', 'NOT_FOUND', 404);
    }

    const updated = await fastify.prisma.tag.update({
      where: { id: request.params.id },
      data,
    });

    return reply.send(success(updated));
  });

  // DELETE /api/v1/tags/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const tag = await fastify.prisma.tag.findFirst({
      where: { id: request.params.id, tenantId: request.agent.tenantId },
    });

    if (!tag) {
      throw new AppError('Tag not found', 'NOT_FOUND', 404);
    }

    // Delete all contact_tags referencing this tag first
    await fastify.prisma.contactTag.deleteMany({
      where: { tagId: request.params.id },
    });

    await fastify.prisma.tag.delete({
      where: { id: request.params.id },
    });

    return reply.send(success({ deleted: true }));
  });
}
