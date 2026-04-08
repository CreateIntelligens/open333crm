import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { initVisitorSession, handleVisitorMessage, isValidUuid } from './webchat.service.js';
import { success } from '../../shared/utils/response.js';

const sessionBodySchema = z.object({
  visitorToken: z.string().uuid(),
});

const messageBodySchema = z.object({
  visitorToken: z.string().uuid(),
  contentType: z.string().default('text'),
  content: z.object({ text: z.string().min(1) }).passthrough(),
});

export default async function webchatRoutes(app: FastifyInstance) {
  // POST /api/v1/webchat/:channelId/sessions — no auth, public
  app.post<{ Params: { channelId: string }; Body: unknown }>(
    '/:channelId/sessions',
    async (req, reply) => {
      const params = sessionBodySchema.safeParse(req.body);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid visitorToken (must be UUID)' });
      }

      const { channelId } = req.params;
      if (!isValidUuid(channelId)) {
        return reply.status(400).send({ error: 'Invalid channelId' });
      }

      const result = await initVisitorSession(req.server.prisma, channelId, params.data.visitorToken);
      return reply.send(success(result));
    },
  );

  // POST /api/v1/webchat/:channelId/messages — no auth, public
  app.post<{ Params: { channelId: string }; Body: unknown }>(
    '/:channelId/messages',
    async (req, reply) => {
      const body = messageBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const { channelId } = req.params;
      if (!isValidUuid(channelId)) {
        return reply.status(400).send({ error: 'Invalid channelId' });
      }

      await handleVisitorMessage(
        req.server.prisma,
        req.server.io,
        channelId,
        body.data.visitorToken,
        body.data.contentType,
        body.data.content as Record<string, unknown>,
      );

      return reply.send(success({ ok: true }));
    },
  );
}
