/**
 * Portal Admin API routes — CRUD for activities + points management.
 * Prefix: /api/v1/portal
 */

import type { FastifyInstance } from 'fastify';
import {
  listActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  publishActivity,
  endActivity,
  listSubmissions,
  drawWinners,
} from './portal.service.js';
import {
  listPointTransactions,
  addPointTransaction,
  getPointBalance,
} from './points.service.js';
import { requireAdmin } from '../../guards/rbac.guard.js';

export default async function portalRoutes(app: FastifyInstance) {
  // All routes require agent JWT
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireAdmin());

  // ── Activities ────────────────────────────────────────────────────────────

  app.get('/activities', async (request) => {
    const { type, status, page, limit } = request.query as Record<string, string>;
    const result = await listActivities(app.prisma, request.agent.tenantId, {
      type,
      status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/activities', async (request) => {
    const body = request.body as Record<string, unknown>;
    const activity = await createActivity(app.prisma, request.agent.tenantId, request.agent.id, body as Parameters<typeof createActivity>[3]);
    return { success: true, data: activity };
  });

  app.get('/activities/:id', async (request) => {
    const { id } = request.params as { id: string };
    const activity = await getActivity(app.prisma, id, request.agent.tenantId);
    if (!activity) return { success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } };
    return { success: true, data: activity };
  });

  app.patch('/activities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    try {
      const activity = await updateActivity(app.prisma, id, request.agent.tenantId, body as Parameters<typeof updateActivity>[3]);
      if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return { success: true, data: activity };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.delete('/activities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await deleteActivity(app.prisma, id, request.agent.tenantId);
      if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return { success: true };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.post('/activities/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const activity = await publishActivity(app.prisma, id, request.agent.tenantId);
      if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return { success: true, data: activity };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.post('/activities/:id/end', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const activity = await endActivity(app.prisma, id, request.agent.tenantId);
      if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return { success: true, data: activity };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  // ── Submissions ───────────────────────────────────────────────────────────

  app.get('/activities/:id/submissions', async (request) => {
    const { id } = request.params as { id: string };
    const { page, limit } = request.query as Record<string, string>;
    const result = await listSubmissions(app.prisma, id, request.agent.tenantId, page ? parseInt(page) : undefined, limit ? parseInt(limit) : undefined);
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/activities/:id/draw', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { count } = request.body as { count: number };
    if (!count || count < 1) return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'count is required' } });
    const winners = await drawWinners(app.prisma, id, request.agent.tenantId, count);
    return { success: true, data: winners };
  });

  // ── Points ────────────────────────────────────────────────────────────────

  app.get('/points', async (request) => {
    const { contactId, page, limit } = request.query as Record<string, string>;
    if (!contactId) return { success: true, data: [], meta: { total: 0 } };
    const result = await listPointTransactions(app.prisma, request.agent.tenantId, contactId, page ? parseInt(page) : undefined, limit ? parseInt(limit) : undefined);
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/points/adjust', async (request, reply) => {
    const { contactId, amount, note } = request.body as { contactId: string; amount: number; note?: string };
    if (!contactId || amount === undefined) return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'contactId and amount required' } });
    const tx = await addPointTransaction(app.prisma, {
      tenantId: request.agent.tenantId,
      contactId,
      amount,
      type: 'admin_adjust',
      note,
    });
    return { success: true, data: tx };
  });

  app.get('/points/balance/:contactId', async (request) => {
    const { contactId } = request.params as { contactId: string };
    const balance = await getPointBalance(app.prisma, contactId);
    return { success: true, data: { contactId, balance } };
  });
}
