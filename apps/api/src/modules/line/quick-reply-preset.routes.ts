/**
 * Quick Reply Preset routes
 *
 * 前綴：/api/v1/line/quick-reply-presets
 * 列表（GET /）所有登入 agent 可讀（客服選 preset 用）；其他寫操作需 SUPERVISOR 以上
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import {
  listPresetsFlow,
  createPresetFlow,
  updatePresetFlow,
  deletePresetFlow,
} from './quick-reply-preset.flow.js';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';

const idParams = z.object({ id: z.string().uuid('預設組識別格式不正確') });

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
    const list = await listPresetsFlow(fastify, actorOf(request).tenantId);
    return reply.send(success(list));
  });

  // 以下寫操作限 SUPERVISOR
  fastify.post('/', { preHandler: [requirePermission('quickreply.manage')] }, async (request, reply) => {
    const data = createSchema.parse(request.body);
    const preset = await createPresetFlow(fastify, actorOf(request).tenantId, data);
    return reply.code(201).send(success(preset));
  });

  fastify.patch(
    '/:id',
    { preHandler: [requirePermission('quickreply.manage')] },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const data = updateSchema.parse(request.body);
      const preset = await updatePresetFlow(fastify, actorOf(request).tenantId, id, data);
      return reply.send(success(preset));
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: [requirePermission('quickreply.manage')] },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const result = await deletePresetFlow(fastify, actorOf(request).tenantId, id);
      return reply.send(success(result));
    },
  );
}
