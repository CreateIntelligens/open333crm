/**
 * 公開領券連結的後台 API（add-coupon-system A15 15.29；design D30）。Prefix: /api/v1/coupons
 *
 * 看清單需 coupon.view，建立、修改、停用需 coupon.manage。每個 handler 以 tenantHandler() 在綁定租戶的交易內執行。
 * 路徑寫成字串字面值：部署前的 OpenAPI 產生器（openapi-inventory.mjs）只認得字面值路徑。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import { tenantHandler, type TenantCtx, type TenantReply } from '../../lib/tenant-ctx.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';
import { generateQrCode, generateQrCodePng } from '../shortlink/qrcode.service.js';
import { CouponValidationError } from './coupon.service.js';
import {
  createClaimLink,
  getClaimLink,
  listClaimLinks,
  setClaimLinkStatus,
  updateClaimLink,
} from './coupon-claim-link.service.js';

// ⚠️ 日期一律用 z.coerce.date()：前端的 datetime-local 送的是「2026-12-31T23:59」
const date = z.coerce.date({ errorMap: () => ({ message: '日期格式不正確' }) });
const name = z.string({ required_error: '請輸入連結名稱' }).trim().min(1, '請輸入連結名稱').max(30, '連結名稱上限 30 字');

const createSchema = z.object({
  name,
  channelId: z.string({ required_error: '請選擇渠道' }).uuid('渠道識別格式不正確'),
  startAt: date.nullable().optional(),
  endAt: date.nullable().optional(),
});
const updateSchema = z.object({
  name: name.optional(),
  startAt: date.nullable().optional(),
  endAt: date.nullable().optional(),
});
const couponParams = z.object({ id: z.string().uuid('優惠券識別格式不正確') });
const linkParams = couponParams.extend({ linkId: z.string().uuid('領券連結識別格式不正確') });

const webBaseUrl = () => getConfig().WEB_BASE_URL;

function handler(app: FastifyInstance, fn: (request: FastifyRequest, reply: TenantReply, ctx: TenantCtx) => Promise<unknown>) {
  return tenantHandler(app, async (request, reply, ctx) => {
    try {
      return await fn(request, reply, ctx);
    } catch (err) {
      if (err instanceof CouponValidationError) throw new AppError(err.message, 'VALIDATION_ERROR', 400);
      throw err;
    }
  });
}

function notFound(reply: TenantReply, message: string) {
  reply.code(404);
  return { success: false, error: { code: 'NOT_FOUND', message } };
}

export default async function couponClaimLinkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/:id/claim-links', { preHandler: [requirePermission('coupon.view')] }, handler(app, async (request, reply, ctx) => {
    const { id } = couponParams.parse(request.params);
    const links = await listClaimLinks(ctx, id, webBaseUrl());
    if (!links) return notFound(reply, '查無此券');
    return { success: true, data: links };
  }));

  app.post('/:id/claim-links', { preHandler: [requirePermission('coupon.manage')] }, handler(app, async (request, reply, ctx) => {
    const { id } = couponParams.parse(request.params);
    const body = createSchema.parse(request.body ?? {});
    const link = await createClaimLink(ctx, id, request.agent.id, body, webBaseUrl());
    if (!link) return notFound(reply, '查無此券');
    reply.code(201);
    return { success: true, data: { ...link, qrCode: await generateQrCode(link.url) } };
  }));

  app.patch('/:id/claim-links/:linkId', { preHandler: [requirePermission('coupon.manage')] }, handler(app, async (request, reply, ctx) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await updateClaimLink(ctx, id, linkId, updateSchema.parse(request.body ?? {}), webBaseUrl());
    if (!link) return notFound(reply, '查無此領券連結');
    return { success: true, data: link };
  }));

  app.post('/:id/claim-links/:linkId/disable', { preHandler: [requirePermission('coupon.manage')] }, handler(app, async (request, reply, ctx) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await setClaimLinkStatus(ctx, id, linkId, 'DISABLED', webBaseUrl());
    if (!link) return notFound(reply, '查無此領券連結');
    return { success: true, data: link };
  }));

  app.post('/:id/claim-links/:linkId/enable', { preHandler: [requirePermission('coupon.manage')] }, handler(app, async (request, reply, ctx) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await setClaimLinkStatus(ctx, id, linkId, 'ACTIVE', webBaseUrl());
    if (!link) return notFound(reply, '查無此領券連結');
    return { success: true, data: link };
  }));

  /** 下載 QR Code（PNG） */
  app.get('/:id/claim-links/:linkId/qrcode', { preHandler: [requirePermission('coupon.view')] }, handler(app, async (request, reply, ctx) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await getClaimLink(ctx, id, linkId, webBaseUrl());
    if (!link) return notFound(reply, '查無此領券連結');
    reply.header('content-type', 'image/png');
    reply.header('content-disposition', `attachment; filename="coupon-claim-${link.code}.png"`);
    return generateQrCodePng(link.url);
  }));
}
