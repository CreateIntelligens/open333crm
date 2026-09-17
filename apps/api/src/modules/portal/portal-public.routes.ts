/**
 * Fan Public API routes — public portal access with fan JWT.
 * Prefix: /api/v1/fan
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { signFanToken, verifyFanToken, type FanPayload } from './portal-auth.service.js';
import { consumeAuthTicket } from '../fan-auth/auth-ticket.service.js';
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

  /**
   * 以綁定票據換取 fan token。
   *
   * ⚠️ 舊版此端點僅憑 contactId + tenantId 即簽發 24 小時 token，**無任何身分驗證** ——
   * 取得或猜到他人 contactId 即可存取其資料。券帶金錢價值後屬上線阻斷，故已移除。
   * 現行流程：顧客於 LINE 完成 Account Link → LINE 平台驗證身分 → webhook 收到
   * result=ok → 簽發一次性 ticket → 顧客端持 ticket 換 token（design D11）。
   */
  app.post('/auth', async (request, reply) => {
    const { ticket } = request.body as { ticket?: string };
    if (!ticket) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: '需要綁定票據' },
      });
    }

    const claimed = await consumeAuthTicket(ticket);
    if (!claimed) {
      // 票據查無／已使用／已過期——三者對顧客而言處理方式相同：重新操作
      return reply.status(401).send({
        success: false,
        error: { code: 'TICKET_INVALID', message: '票據無效或已過期，請重新點選連結' },
      });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: claimed.contactId, tenantId: claimed.tenantId },
      select: { id: true },
    });
    if (!contact) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: '查無此聯絡人' },
      });
    }

    const token = signFanToken(claimed.contactId, claimed.tenantId);
    return {
      success: true,
      data: { token, contactId: claimed.contactId, tenantId: claimed.tenantId },
    };
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
