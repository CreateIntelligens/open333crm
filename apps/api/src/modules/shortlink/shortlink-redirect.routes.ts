/**
 * Public short link redirect route.
 * Prefix: /s
 */

import type { FastifyInstance } from 'fastify';
import { handleClick } from './shortlink.service.js';

export default async function shortlinkRedirectRoutes(app: FastifyInstance) {
  // No auth required — public route

  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { cid } = request.query as { cid?: string };

    const redirectUrl = await handleClick(app.prisma, slug, {
      contactId: cid,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      referer: request.headers.referer,
    }, app.io);

    if (!redirectUrl) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Link not found or expired' } });
    }

    return reply.status(302).redirect(redirectUrl);
  });
}
