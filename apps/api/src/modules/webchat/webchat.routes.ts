import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { initVisitorSession, handleVisitorMessage, uploadVisitorMedia, isValidUuid } from './webchat.service.js';
import { success } from '../../shared/utils/response.js';

const sessionBodySchema = z.object({
  visitorToken: z.string().uuid(),
});

const messageBodySchema = z.object({
  visitorToken: z.string().uuid(),
  contentType: z.string().default('text'),
  content: z.object({ text: z.string().optional(), url: z.string().optional() }).passthrough(),
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

      const { contentType, content } = body.data;

      if (contentType === 'text' && !content.text) {
        return reply.status(400).send({ error: 'content.text is required for text messages' });
      }
      if ((contentType === 'image' || contentType === 'video') && !content.url) {
        return reply.status(400).send({ error: 'content.url is required for media messages' });
      }

      await handleVisitorMessage(
        req.server.prisma,
        req.server.io,
        channelId,
        body.data.visitorToken,
        contentType,
        content as Record<string, unknown>,
      );

      return reply.send(success({ ok: true }));
    },
  );

  // POST /api/v1/webchat/:channelId/media — no auth, public; multipart file upload
  app.post<{ Params: { channelId: string } }>(
    '/:channelId/media',
    async (req, reply) => {
      const { channelId } = req.params;
      if (!isValidUuid(channelId)) {
        return reply.status(400).send({ error: 'Invalid channelId' });
      }

      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const visitorToken = data.fields?.visitorToken as { value?: string } | undefined;
      if (!visitorToken?.value || !isValidUuid(visitorToken.value)) {
        return reply.status(400).send({ error: 'Invalid visitorToken (must be UUID)' });
      }

      const buffer = await data.toBuffer();
      const result = await uploadVisitorMedia(
        req.server.prisma,
        channelId,
        visitorToken.value,
        buffer,
        data.filename,
        data.mimetype,
      );

      return reply.send(success(result));
    },
  );
}
