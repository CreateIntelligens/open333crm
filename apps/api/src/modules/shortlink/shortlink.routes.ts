/**
 * ShortLink Admin API routes — CRUD + stats.
 * Prefix: /api/v1/shortlinks
 */

import type { FastifyInstance } from 'fastify';
import {
  listShortLinks,
  getShortLink,
  createShortLink,
  updateShortLink,
  deleteShortLink,
  getClickStats,
  getClickLogs,
} from './shortlink.service.js';
import { generateQrCode } from './qrcode.service.js';

export default async function shortlinkRoutes(app: FastifyInstance) {
  // All routes require agent JWT
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const { isActive, q, page, limit } = request.query as Record<string, string>;
    const result = await listShortLinks(app.prisma, request.agent.tenantId, {
      isActive,
      q,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const link = await createShortLink(app.prisma, request.agent.tenantId, request.agent.id, body as Parameters<typeof createShortLink>[3]);
      return { success: true, data: link };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const link = await getShortLink(app.prisma, id, request.agent.tenantId);
    if (!link) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Short link not found' } });
    return { success: true, data: link };
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const link = await updateShortLink(app.prisma, id, request.agent.tenantId, body as Parameters<typeof updateShortLink>[3]);
    if (!link) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Short link not found' } });
    return { success: true, data: link };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteShortLink(app.prisma, id, request.agent.tenantId);
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Short link not found' } });
    return { success: true };
  });

  app.get('/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stats = await getClickStats(app.prisma, id, request.agent.tenantId);
    if (!stats) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Short link not found' } });
    return { success: true, data: stats };
  });

  app.get('/:id/clicks', async (request) => {
    const { id } = request.params as { id: string };
    const { page, limit } = request.query as Record<string, string>;
    const result = await getClickLogs(app.prisma, id, request.agent.tenantId, page ? parseInt(page) : undefined, limit ? parseInt(limit) : undefined);
    if (!result) return { success: false, error: { code: 'NOT_FOUND', message: 'Short link not found' } };
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.get('/:id/qrcode', async (request, reply) => {
    const { id } = request.params as { id: string };
    const link = await getShortLink(app.prisma, id, request.agent.tenantId);
    if (!link) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Short link not found' } });

    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
    const shortUrl = `${baseUrl}/s/${link.slug}`;
    const qrDataUri = await generateQrCode(shortUrl);
    return { success: true, data: { url: shortUrl, qrcode: qrDataUri } };
  });
}
