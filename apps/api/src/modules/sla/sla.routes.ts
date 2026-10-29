import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { createSlaPolicyFlow, deleteSlaPolicyFlow, listSlaPoliciesFlow, updateSlaPolicyFlow } from './sla.flow.js';
import { slaMinutesSchema } from '../../shared/utils/numeric-bounds.js';

const createSlaSchema = z.object({
  name: z.string().trim().min(1),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  firstResponseMinutes: slaMinutesSchema,
  resolutionMinutes: slaMinutesSchema,
  warningBeforeMinutes: slaMinutesSchema.default(30),
  isDefault: z.boolean().default(false),
});

const updateSlaSchema = z.object({
  name: z.string().trim().min(1).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  firstResponseMinutes: slaMinutesSchema.optional(),
  resolutionMinutes: slaMinutesSchema.optional(),
  warningBeforeMinutes: slaMinutesSchema.optional(),
  isDefault: z.boolean().optional(),
});

export default async function slaRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePermission('sla.manage'));

  // GET /api/v1/sla-policies
  fastify.get('/', async (request, reply) => {
    return reply.send(success(await listSlaPoliciesFlow(fastify, actorOf(request).tenantId)));
  });

  // POST /api/v1/sla-policies — 名稱在租戶內不可重複（工單以名稱記錄政策）
  fastify.post('/', async (request, reply) => {
    const data = createSlaSchema.parse(request.body);
    const policy = await createSlaPolicyFlow(fastify, actorOf(request).tenantId, data);
    return reply.status(201).send(success(policy));
  });

  // PATCH /api/v1/sla-policies/:id — 改名時同步工單上記的政策名稱
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateSlaSchema.parse(request.body);
    const updated = await updateSlaPolicyFlow(fastify, actorOf(request).tenantId, request.params.id, data);
    return reply.send(success(updated));
  });

  // DELETE /api/v1/sla-policies/:id — 仍有未結案工單使用時回 409
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    return reply.send(success(await deleteSlaPolicyFlow(fastify, actorOf(request).tenantId, request.params.id)));
  });
}
