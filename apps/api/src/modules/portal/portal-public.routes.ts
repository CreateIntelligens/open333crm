/**
 * Fan Public API routes — public portal access with fan JWT.
 * Prefix: /api/v1/fan
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { signFanToken, verifyFanToken, type FanPayload } from './portal-auth.service.js';
import { submitActivity, getActivityResult } from './portal.service.js';
import { getPointBalance, listPointTransactions } from './points.service.js';

// Extend FastifyRequest with fan payload
declare module 'fastify' {
  interface FastifyRequest {
    fan?: FanPayload;
  }
}

/**
 * Authenticate fan JWT from Authorization header.
 */
async function authenticateFan(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Fan token required' } });
  }
  const token = authHeader.slice(7);
  const payload = verifyFanToken(token);
  if (!payload) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid fan token' } });
  }
  request.fan = payload;
}

export default async function portalPublicRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = app.prisma;

  // ── Auth (no JWT required) ────────────────────────────────────────────────

  app.post('/auth', async (request, reply) => {
    const { contactId, tenantId } = request.body as { contactId: string; tenantId: string };
    if (!contactId || !tenantId) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'contactId and tenantId required' } });
    }
    // Verify contact exists
    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
    if (!contact) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    }
    const token = signFanToken(contactId, tenantId);
    return { success: true, data: { token, contactId, tenantId } };
  });

  // ── Protected routes (fan JWT) ────────────────────────────────────────────

  app.get('/activities', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const now = new Date();
    const activities = await prisma.portalActivity.findMany({
      where: {
        tenantId: fan.tenantId,
        status: 'PUBLISHED',
        OR: [
          { startsAt: null },
          { startsAt: { lte: now } },
        ],
      },
      include: {
        _count: { select: { submissions: true } },
        options: { orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, imageUrl: true, sortOrder: true } },
        fields: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { publishedAt: 'desc' },
    });

    // Filter out activities that have ended
    const filtered = activities.filter((a) => !a.endsAt || a.endsAt > now);

    return { success: true, data: filtered };
  });

  app.get('/activities/:id', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = request.params as { id: string };
    const activity = await prisma.portalActivity.findFirst({
      where: { id, tenantId: fan.tenantId, status: 'PUBLISHED' },
      include: {
        options: { orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, imageUrl: true, sortOrder: true } },
        fields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { submissions: true } },
      },
    });
    if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });

    // Check if fan has already submitted
    const mySubmission = await prisma.portalSubmission.findFirst({
      where: { activityId: id, contactId: fan.contactId },
    });

    return { success: true, data: { ...activity, mySubmission } };
  });

  app.post('/activities/:id/submit', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = request.params as { id: string };
    const body = request.body as { optionIds?: string[]; fields?: Record<string, string> };
    try {
      const submission = await submitActivity(prisma, id, fan.contactId, fan.tenantId, body);
      return { success: true, data: submission };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.get('/activities/:id/result', { preHandler: authenticateFan }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getActivityResult(prisma, id);
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return { success: true, data: result };
  });

  app.get('/me/activities', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const submissions = await prisma.portalSubmission.findMany({
      where: { contactId: fan.contactId, tenantId: fan.tenantId },
      include: { activity: { select: { id: true, title: true, type: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: submissions };
  });

  app.get('/me/points', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const [balance, transactions] = await Promise.all([
      getPointBalance(prisma, fan.contactId),
      listPointTransactions(prisma, fan.tenantId, fan.contactId, 1, 50),
    ]);
    return { success: true, data: { balance, transactions: transactions.items } };
  });
}
