import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { AppError } from '../../shared/utils/response.js';

const createSlaSchema = z.object({
  name: z.string().min(1),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  firstResponseMinutes: z.number().int().positive(),
  resolutionMinutes: z.number().int().positive(),
  warningBeforeMinutes: z.number().int().positive().default(30),
  isDefault: z.boolean().default(false),
});

const updateSlaSchema = z.object({
  name: z.string().min(1).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  firstResponseMinutes: z.number().int().positive().optional(),
  resolutionMinutes: z.number().int().positive().optional(),
  warningBeforeMinutes: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
});

export default async function slaRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/sla-policies
  fastify.get('/', async (request, reply) => {
    const policies = await fastify.prisma.slaPolicy.findMany({
      where: { tenantId: request.agent.tenantId },
      orderBy: { priority: 'asc' },
    });

    return reply.send(success(policies));
  });

  // POST /api/v1/sla-policies
  fastify.post('/', async (request, reply) => {
    const data = createSlaSchema.parse(request.body);

    // If setting as default, unset other defaults for same priority
    if (data.isDefault) {
      await fastify.prisma.slaPolicy.updateMany({
        where: {
          tenantId: request.agent.tenantId,
          priority: data.priority,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    const policy = await fastify.prisma.slaPolicy.create({
      data: {
        tenantId: request.agent.tenantId,
        ...data,
      },
    });

    return reply.status(201).send(success(policy));
  });

  // PATCH /api/v1/sla-policies/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateSlaSchema.parse(request.body);

    const policy = await fastify.prisma.slaPolicy.findFirst({
      where: { id: request.params.id, tenantId: request.agent.tenantId },
    });

    if (!policy) {
      throw new AppError('SLA policy not found', 'NOT_FOUND', 404);
    }

    // If setting as default, unset other defaults for same priority
    if (data.isDefault) {
      const targetPriority = data.priority || policy.priority;
      await fastify.prisma.slaPolicy.updateMany({
        where: {
          tenantId: request.agent.tenantId,
          priority: targetPriority,
          isDefault: true,
          id: { not: request.params.id },
        },
        data: { isDefault: false },
      });
    }

    const updated = await fastify.prisma.slaPolicy.update({
      where: { id: request.params.id },
      data,
    });

    return reply.send(success(updated));
  });

  // DELETE /api/v1/sla-policies/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const policy = await fastify.prisma.slaPolicy.findFirst({
      where: { id: request.params.id, tenantId: request.agent.tenantId },
    });

    if (!policy) {
      throw new AppError('SLA policy not found', 'NOT_FOUND', 404);
    }

    await fastify.prisma.slaPolicy.delete({
      where: { id: request.params.id },
    });

    return reply.send(success({ deleted: true }));
  });
}
