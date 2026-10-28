/**
 * 公開領券連結的後台 API（add-coupon-system A15 15.29；design D30）。Prefix: /api/v1/coupons
 *
 * 看清單需 coupon.view（素材編輯器用的「全部可用連結」為 coupon.view 或 marketing.manage），建立、修改、停用需 coupon.manage。讀寫都經過 coupon-claim-link.flow；QR Code 在交易外產生。
 * 路徑寫成字串字面值：部署前的 OpenAPI 產生器（openapi-inventory.mjs）只認得字面值路徑。
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod/v3';
import { requireAnyPermission, requirePermission } from '../../guards/rbac.guard.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';
import { generateQrCode, generateQrCodePng } from '../shortlink/qrcode.service.js';
import { CouponValidationError } from './coupon.service.js';
import {
  createClaimLinkFlow,
  getClaimLinkFlow,
  listAvailableClaimLinksFlow,
  listClaimLinksFlow,
  setClaimLinkStatusFlow,
  updateClaimLinkFlow,
} from './coupon-claim-link.flow.js';

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
const availableQuery = z.object({
  channelType: z.enum(['LINE', 'FB', 'THREADS'], { errorMap: () => ({ message: '渠道類型只能是 LINE、FB 或 THREADS' }) }).optional(),
});

const webBaseUrl = () => getConfig().WEB_BASE_URL;

/** service 錯誤轉成 AppError（交易已回滾） */
async function linkErrors<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (err) {
    if (err instanceof CouponValidationError) throw new AppError(err.message, 'VALIDATION_ERROR', 400);
    throw err;
  }
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message } });
}

export default async function couponClaimLinkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // 租戶內可用的領券連結（素材編輯器「插入領券連結」，change improve-coupon-url-insert-ux design D6）。
  // 素材編輯者通常只有 marketing.manage，所以 coupon.view 或 marketing.manage 任一即可。
  // 靜態路徑優先於 /:id，不會被當成券 id
  app.get('/claim-links', { preHandler: [requireAnyPermission(['coupon.view', 'marketing.manage'])] }, async (request) => {
    const { channelType } = availableQuery.parse(request.query ?? {});
    const links = await listAvailableClaimLinksFlow(app, request.agent.tenantId, webBaseUrl(), channelType ? { channelType } : {});
    return { success: true, data: links };
  });

  app.get('/:id/claim-links', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id } = couponParams.parse(request.params);
    const links = await linkErrors(listClaimLinksFlow(app, request.agent.tenantId, id, webBaseUrl()));
    if (!links) return notFound(reply, '查無此券');
    return { success: true, data: links };
  });

  app.post('/:id/claim-links', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id } = couponParams.parse(request.params);
    const body = createSchema.parse(request.body ?? {});
    const link = await linkErrors(createClaimLinkFlow(app, request.agent.tenantId, id, request.agent.id, body, webBaseUrl()));
    if (!link) return notFound(reply, '查無此券');
    return reply.code(201).send({ success: true, data: { ...link, qrCode: await generateQrCode(link.url) } });
  });

  app.patch('/:id/claim-links/:linkId', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id, linkId } = linkParams.parse(request.params);
    const body = updateSchema.parse(request.body ?? {});
    const link = await linkErrors(updateClaimLinkFlow(app, request.agent.tenantId, id, linkId, body, webBaseUrl()));
    if (!link) return notFound(reply, '查無此領券連結');
    return { success: true, data: link };
  });

  app.post('/:id/claim-links/:linkId/disable', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await linkErrors(setClaimLinkStatusFlow(app, request.agent.tenantId, id, linkId, 'DISABLED', webBaseUrl()));
    if (!link) return notFound(reply, '查無此領券連結');
    return { success: true, data: link };
  });

  app.post('/:id/claim-links/:linkId/enable', { preHandler: [requirePermission('coupon.manage')] }, async (request, reply) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await linkErrors(setClaimLinkStatusFlow(app, request.agent.tenantId, id, linkId, 'ACTIVE', webBaseUrl()));
    if (!link) return notFound(reply, '查無此領券連結');
    return { success: true, data: link };
  });

  /** 下載 QR Code（PNG） */
  app.get('/:id/claim-links/:linkId/qrcode', { preHandler: [requirePermission('coupon.view')] }, async (request, reply) => {
    const { id, linkId } = linkParams.parse(request.params);
    const link = await linkErrors(getClaimLinkFlow(app, request.agent.tenantId, id, linkId, webBaseUrl()));
    if (!link) return notFound(reply, '查無此領券連結');
    return reply
      .header('content-type', 'image/png')
      .header('content-disposition', `attachment; filename="coupon-claim-${link.code}.png"`)
      .send(await generateQrCodePng(link.url));
  });
}
