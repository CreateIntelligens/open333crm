/**
 * Quick Reply Preset routes
 *
 * 前綴：/api/v1/line/quick-reply-presets
 * 列表（GET /）所有登入 agent 可讀（客服選 preset 用）；其他寫操作需 SUPERVISOR 以上
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
} from './quick-reply-preset.service.js';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';

const itemSchema = z.object({
  label: z.string().min(1).max(20),
  text: z.string().min(1).max(300).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  items: z.array(itemSchema).min(1).max(13),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  items: z.array(itemSchema).min(1).max(13).optional(),
  isActive: z.boolean().optional(),
});

export default async function quickReplyPresetRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/line/quick-reply-presets — 任何登入 agent 可讀
  fastify.get('/', async (request, reply) => {
    const list = await listPresets(fastify.prisma, request.agent.tenantId);
    return reply.send(success(list));
  });

  // 以下寫操作限 SUPERVISOR
  fastify.post('/', { preHandler: [requirePermission('quickreply.manage')] }, async (request, reply) => {
    const data = createSchema.parse(request.body);
    const preset = await createPreset(fastify.prisma, request.agent.tenantId, data);
    return reply.code(201).send(success(preset));
  });

  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requirePermission('quickreply.manage')] },
    async (request, reply) => {
      const data = updateSchema.parse(request.body);
      const preset = await updatePreset(
        fastify.prisma,
        request.params.id,
        request.agent.tenantId,
        data,
      );
      return reply.send(success(preset));
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requirePermission('quickreply.manage')] },
    async (request, reply) => {
      const result = await deletePreset(
        fastify.prisma,
        request.params.id,
        request.agent.tenantId,
      );
      return reply.send(success(result));
    },
  );
}
