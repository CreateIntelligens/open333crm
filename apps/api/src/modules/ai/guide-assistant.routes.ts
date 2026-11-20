/**
 * 後台助理（規格 dashboard-guide-assistant）。index.ts 以前綴 `/api/v1/ai/guide-assistant` 註冊。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { createOutboxPublisher, type EventPublisher } from '../../events/outbox-publisher.js';
import { getRequestPermissions, requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { success } from '../../shared/utils/response.js';
import { askGuideAssistantFlow } from './guide-assistant.flow.js';

export interface GuideAssistantRoutesOptions {
  /** 測試注入假的 publisher；未傳時寫 outbox */
  events?: EventPublisher;
}

const askSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(6)
    .default([]),
  currentPath: z.string().max(300).regex(/^\//).optional(),
});

export default async function guideAssistantRoutes(fastify: FastifyInstance, opts: GuideAssistantRoutesOptions = {}) {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/v1/ai/guide-assistant/ask
  fastify.post('/ask', { preHandler: requirePermission('assistant.use') }, async (request, reply) => {
    const input = askSchema.parse(request.body);
    const permissions = await getRequestPermissions(request);
    const deps = {
      prisma: fastify.prisma,
      redis: fastify.redis,
      events: opts.events ?? createOutboxPublisher(fastify.prisma),
    };
    const result = await askGuideAssistantFlow(deps, actorOf(request).tenantId, input, permissions);
    return reply.send(success(result));
  });
}
