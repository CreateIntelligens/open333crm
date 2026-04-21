import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { syncLineContactProfile } from './line-profile.service.js';
import { success } from '../../shared/utils/response.js';

export default async function lineProfileRoutes(fastify: FastifyInstance) {
  fastify.patch<{
    Params: { channelId: string; lineUid: string };
  }>(
    '/channels/:channelId/contacts/:lineUid/sync-profile',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { channelId, lineUid } = z
        .object({
          channelId: z.string().min(1),
          lineUid: z.string().min(1),
        })
        .parse(request.params);

      const updated = await syncLineContactProfile(fastify.prisma, channelId, lineUid);

      return reply.send(success(updated));
    },
  );
}
