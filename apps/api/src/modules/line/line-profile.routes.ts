import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { LINE_CHANNEL_NOT_FOUND } from './line-profile.service.js';
import { syncLineContactProfileFlow } from './line-profile.flow.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { isChannelAccessible, resolveChannelVisibility } from '../../services/channel-visibility.js';
import { AppError, success } from '../../shared/utils/response.js';
import { actorOf } from '../../lib/request-actor.js';

export default async function lineProfileRoutes(fastify: FastifyInstance) {
  fastify.patch<{
    Params: { channelId: string; lineUid: string };
  }>(
    '/channels/:channelId/contacts/:lineUid/sync-profile',
    { preHandler: [fastify.authenticate, requirePermission('contact.update')] },
    async (request, reply) => {
      const { channelId, lineUid } = z
        .object({
          channelId: z.string().uuid(),
          lineUid: z.string().min(1),
        })
        .parse(request.params);

      // 看不到的渠道視為不存在，與其他租戶的渠道回同樣的 404（AUDIT RLS-05）
      if (!isChannelAccessible(await resolveChannelVisibility(request), channelId)) {
        throw new AppError(LINE_CHANNEL_NOT_FOUND, 'NOT_FOUND', 404);
      }

      const updated = await syncLineContactProfileFlow(fastify, actorOf(request).tenantId, channelId, lineUid);

      return reply.send(success(updated));
    },
  );
}
