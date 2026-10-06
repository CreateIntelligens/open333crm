/**
 * Fan Public API routes — public portal access with fan JWT.
 * Prefix: /api/v1/fan
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { withTenant } from '../../lib/tenant-db.js';
import { verifyFanToken, type FanPayload } from './portal-auth.service.js';
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
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '請先完成身分驗證' } });
  }
  const token = authHeader.slice(7);
  const payload = verifyFanToken(token);
  if (!payload) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '登入已失效，請重新開啟連結' } });
  }
  request.fan = payload;
}

export default async function portalPublicRoutes(app: FastifyInstance) {
  // 粉絲門戶是公開端點（訪客持 fanToken，非租戶客服登入）。租戶取自已驗簽的 fanToken，
  // 每個請求以 withTenant 綁定該租戶，查詢走 RLS（不使用 BYPASSRLS 的 prismaAdmin）：
  // 查詢條件漏帶 tenantId 時仍有 RLS 兜底（原本 getPointBalance 就漏帶，AUDIT RLS-07 的 code review）。
  const inFanTenant = <T>(fan: FanPayload, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    withTenant(app.prisma, fan.tenantId, fn);

  // 已移除 POST /auth：舊版憑任意 {contactId, tenantId} 即簽發 fanToken，
  // 不驗證呼叫者身分（任何人都能冒充任一顧客）。fanToken 改由經平台驗證的流程
  // 簽發（見 openspec change add-cross-channel-one-id）。

  // ── Protected routes (fan JWT) ────────────────────────────────────────────

  app.get('/activities', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const now = new Date();
    const activities = await inFanTenant(fan, (prisma) => prisma.portalActivity.findMany({
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
    }));

    // Filter out activities that have ended
    const filtered = activities.filter((a) => !a.endsAt || a.endsAt > now);

    return { success: true, data: filtered };
  });

  app.get('/activities/:id', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = request.params as { id: string };
    const found = await inFanTenant(fan, async (prisma) => {
      const activity = await prisma.portalActivity.findFirst({
        where: { id, tenantId: fan.tenantId, status: 'PUBLISHED' },
        include: {
          options: { orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, imageUrl: true, sortOrder: true } },
          fields: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { submissions: true } },
        },
      });
      if (!activity) return null;
      // Check if fan has already submitted
      const mySubmission = await prisma.portalSubmission.findFirst({
        where: { activityId: id, contactId: fan.contactId, tenantId: fan.tenantId },
      });
      return { activity, mySubmission };
    });
    if (!found) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已結束或被下架' } });
    const { activity, mySubmission } = found;

    return { success: true, data: { ...activity, mySubmission } };
  });

  app.post('/activities/:id/submit', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = request.params as { id: string };
    const body = request.body as { optionIds?: string[]; fields?: Record<string, string> };
    try {
      const submission = await inFanTenant(fan, (prisma) => submitActivity(prisma, id, fan.contactId, fan.tenantId, body));
      return { success: true, data: submission };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.get('/activities/:id/result', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = request.params as { id: string };
    const result = await inFanTenant(fan, (prisma) => getActivityResult(prisma, id, fan.tenantId));
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已結束或被下架' } });
    return { success: true, data: result };
  });

  app.get('/me/activities', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const submissions = await inFanTenant(fan, (prisma) => prisma.portalSubmission.findMany({
      where: { contactId: fan.contactId, tenantId: fan.tenantId },
      include: { activity: { select: { id: true, title: true, type: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    }));
    return { success: true, data: submissions };
  });

  app.get('/me/points', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    // 同一個交易內依序查詢（交易用戶端不支援並行查詢）；餘額查詢補上原本漏帶的 tenantId
    const { balance, transactions } = await inFanTenant(fan, async (prisma) => ({
      balance: await getPointBalance(prisma, fan.contactId, fan.tenantId),
      transactions: await listPointTransactions(prisma, fan.tenantId, fan.contactId, 1, 50),
    }));
    return { success: true, data: { balance, transactions: transactions.items } };
  });
}
