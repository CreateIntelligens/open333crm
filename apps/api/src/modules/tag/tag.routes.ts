import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { success } from '../../shared/utils/response.js';
import { actorOf } from '../../lib/request-actor.js';
import { createTagFlow, deleteTagFlow, listTagsFlow, updateTagFlow } from './tag.flow.js';
import { requirePermission } from '../../guards/rbac.guard.js';

const createTagSchema = z.object({
  name: z.string().trim().min(1, '標籤名稱不可為空白').max(50, '標籤名稱不可超過 50 字'),
  color: z.string().default('#6366f1'),
  type: z.enum(['MANUAL', 'AUTO', 'SYSTEM', 'CHANNEL']),
  // MATERIAL：素材標籤（2026-09-23 統一，原本存在 Material.tags 自由字串）
  scope: z.enum(['CONTACT', 'CONVERSATION', 'CASE', 'MATERIAL']),
  description: z.string().optional(),
});

const updateTagSchema = z.object({
  name: z.string().trim().min(1, '標籤名稱不可為空白').max(50, '標籤名稱不可超過 50 字').optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});

// 標籤路由的權限檢查（AUDIT RBAC-01）
const perm = {
  view: requirePermission('tag.view'),
  manage: requirePermission('tag.manage'),
};

export default async function tagRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/tags
  fastify.get('/', { preHandler: [perm.view] }, async (request, reply) => {
    const tags = await listTagsFlow(fastify, actorOf(request).tenantId);
    return reply.send(success(tags));
  });

  // POST /api/v1/tags
  fastify.post('/', { preHandler: [perm.manage] }, async (request, reply) => {
    const data = createTagSchema.parse(request.body);
    const tag = await createTagFlow(fastify, actorOf(request).tenantId, data);
    return reply.status(201).send(success(tag));
  });

  // PATCH /api/v1/tags/:id（找不到標籤時 service 回 404）
  fastify.patch<{ Params: { id: string } }>('/:id', { preHandler: [perm.manage] }, async (request, reply) => {
    const data = updateTagSchema.parse(request.body);
    const updated = await updateTagFlow(fastify, actorOf(request).tenantId, request.params.id, data);
    return reply.send(success(updated));
  });

  // DELETE /api/v1/tags/:id（找不到標籤時 service 回 404）
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [perm.manage] }, async (request, reply) => {
    const result = await deleteTagFlow(fastify, actorOf(request).tenantId, request.params.id);
    return reply.send(success(result));
  });
}
