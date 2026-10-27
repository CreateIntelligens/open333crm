/**
 * 公開領券頁的資料端點（add-coupon-system A15 15.29；design D30）。Prefix: /api/v1/coupon-claim
 *
 * 不需登入。代碼全系統唯一：先以 SECURITY DEFINER 函式查出租戶 id，之後在綁定該租戶的交易內讀資料（RLS 生效），
 * 不使用 prismaAdmin。查無代碼一律回 404，不透露任何商家資料。
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { inTenant } from '../../lib/tenant-ctx.js';
import { findClaimLinkTenant, openPublicClaimPage } from './coupon-claim-link.service.js';

const NOT_FOUND = { success: false, error: { code: 'NOT_FOUND', message: '找不到這個領券活動' } } as const;

export default async function couponClaimPublicRoutes(app: FastifyInstance) {
  // 每次開啟都會累計開啟數，並查一次資料庫：以 IP 限制頻率
  await app.register(rateLimit, { global: true, max: 60, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  app.get('/:code', async (request, reply) => {
    const raw = String((request.params as { code?: unknown }).code ?? '').slice(0, 32);
    const found = await findClaimLinkTenant(app.prisma, raw);
    if (!found) return reply.status(404).send(NOT_FOUND);
    const page = await inTenant(app.prisma, found.tenantId, (ctx) =>
      openPublicClaimPage(ctx, found.code));
    if (!page) return reply.status(404).send(NOT_FOUND);
    return { success: true, data: page };
  });
}
