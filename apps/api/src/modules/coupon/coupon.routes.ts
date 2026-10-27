/**
 * 優惠券後台 API。Prefix: /api/v1/coupons
 *
 * 租戶隔離：沒有副作用的 handler 以 tenantHandler() 在綁定租戶的交易內執行；有推播的核銷經過
 * coupon-redeem.flow。service 只收 TenantCtx（AGENTS.md 結構規則 2）。⚠️ 券系統任何地方都不得使用 prismaAdmin（BYPASSRLS）。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseDateOnly } from '@open333crm/core';
import { COUPON_ISSUED_VIA, isReservedCouponIssuedVia } from '@open333crm/shared';
import { requirePermission } from '../../guards/rbac.guard.js';
import { inTenant, tenantHandler, type TenantCtx, type TenantReply } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import {
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  duplicateCoupon,
  checkSharedCode,
  CouponValidationError,
  CouponLockedError,
  CouponConflictError,
} from './coupon.service.js';
import { changeStatus } from './coupon-lifecycle.service.js';
import { ISSUE_BATCH_SIZE, issueCoupons, type IssueResult } from './coupon-issue.service.js';
import { redeemAtConsole } from './coupon-redeem.flow.js';
import { importCodes, previewImport, removeAvailableCode } from './coupon-import.service.js';
import { assertChannelVisible } from '../../services/channel-visibility.js';
import { previewBroadcastAudience } from '../marketing/marketing.service.js';
import {
  BATCH_ISSUE_MAX_RECIPIENTS,
  listCouponBroadcasts,
} from '../marketing/broadcast-coupon.service.js';
import { createBatchIssueFlow } from '../marketing/broadcast-coupon.flow.js';

// 資料庫欄位是 int4：超過範圍時在這裡擋下，不讓資料庫丟錯變成 500
const int = z.number().int('請輸入整數').min(-2_147_483_648, '數值過小').max(2_147_483_647, '數值過大，請確認輸入');
// ⚠️ 日期一律用 z.coerce.date()，不可用 z.string().datetime()：前端的 date 欄位送的是「2026-10-31」
const date = z.coerce.date({ errorMap: () => ({ message: '日期格式不正確' }) });
/** 只有日期（YYYY-MM-DD）時保留字串，由 service 換算成台灣時間的當天起訖（design D17） */
const dateOrDay = z.union([z.string().refine((v) => parseDateOnly(v) !== null), date]);

/** 欄位格式在這裡擋；欄位間的相依（券型決定要哪些欄位、鎖定欄位）由 service 判斷。 */
const couponInputSchema = z.object({
  name: z.string().max(30, '券名稱上限 30 字'),
  description: z.string().nullable(),
  terms: z.string().nullable(),
  imageUrl: z.string().nullable(),
  couponType: z.enum(['DISCOUNT_AMOUNT', 'DISCOUNT_PERCENT', 'GIFT', 'EXCHANGE']).nullable(),
  purpose: z.enum(['MARKETING', 'SERVICE']).nullable(),
  discountAmount: int.nullable(),
  discountPercent: int.nullable(),
  minSpend: int.nullable(),
  percentCap: int.nullable(),
  giftName: z.string().max(50).nullable(),
  giftQty: int.nullable(),
  exchangeItem: z.string().max(50).nullable(),
  exchangeValueCap: int.nullable(),
  validityMode: z.enum(['FIXED', 'AFTER_CLAIM', 'AFTER_OPEN']).nullable(),
  startAt: dateOrDay.nullable(),
  endAt: dateOrDay.nullable(),
  afterClaimDays: int.nullable(),
  afterOpenMinutes: int.nullable(),
  codeMode: z.enum(['SHARED_CODE', 'UNIQUE_CODE', 'IMPORTED_CODES']).nullable(),
  sharedCode: z.string().nullable(),
  codePrefix: z.string().trim().max(8, '券號前綴最多 8 碼').regex(/^[A-Za-z0-9]*$/, '券號前綴只能使用英文與數字').nullable(),
  redeemMode: z.enum(['STAFF_CODE', 'STAFF_SCAN', 'SELF']).nullable(),
  // 驗證碼一律字串，數字型別會吃掉開頭的 0
  staffCode: z.string().nullable(),
  totalLimit: int.nullable(),
  perContactLimit: int,
  claimTagId: z.string().uuid('標籤 ID 格式不正確').nullable(),
  claimTagTtlDays: int.nullable(),
  maskCodeBeforeStart: z.boolean(),
}).partial();

/** 券 id：格式不對直接回 400，不讓資料庫丟錯 */
const idParams = z.object({ id: z.string().uuid('優惠券識別格式不正確') });

const issueSchema = z.object({
  contactIds: z.array(z.string().uuid('聯絡人識別格式不正確'), { invalid_type_error: '發放對象須為聯絡人清單' })
    .min(1, '請選擇發放對象')
    .max(1000, '單次最多發給 1000 位聯絡人'),
  // 發放方式寫進成效歸因，只接受代號格式；系統保留的代碼（inbox、keyword 等）只有系統自己的發券流程能寫，
  // 整合程式帶入會被當成對話發券或關鍵字發券，所以拒絕（design D31、D32）
  issuedVia: z.string().regex(/^[a-z][a-z0-9._-]{0,39}$/, '發放方式格式不正確')
    .refine((v) => !isReservedCouponIssuedVia(v), '這個發放方式是系統保留的，請改用其他代碼')
    .optional(),
  issuedRefId: z.string().max(100).optional(),
});

/** 券詳情頁「發送給…」（design D31）：選一個渠道與對象，最多 1,000 人 */
const batchAudienceSchema = z.object({
  channelId: z.string().uuid('渠道識別格式不正確'),
  targetType: z.enum(['segment', 'tags', 'contacts']),
  segmentId: z.string().uuid('分眾識別格式不正確').optional(),
  tagIds: z.array(z.string().uuid('標籤識別格式不正確')).max(50, '最多選 50 個標籤').optional(),
  contactIds: z.array(z.string().uuid('聯絡人識別格式不正確'))
    .max(BATCH_ISSUE_MAX_RECIPIENTS, `單次最多發給 ${BATCH_ISSUE_MAX_RECIPIENTS} 位聯絡人`)
    .optional(),
});
const batchIssueSchema = batchAudienceSchema.extend({
  message: z.string().trim().max(500, '訊息文字最多 500 字').optional(),
});

/** 序號清單：一行一組或以逗號分隔的文字（前端 CodeImportField 送出的格式） */
const codesSchema = z.object({ codes: z.string({ invalid_type_error: '序號清單須為文字' }).max(2_000_000, '序號清單過長，請分批匯入').default('') });

const redeemSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  instanceId: z.string().uuid('券識別格式不正確').optional(),
  staffCode: z.string().max(10).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']).optional(),
  purpose: z.enum(['MARKETING', 'SERVICE']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

/** service 的錯誤轉成 AppError（交易會回滾）；其餘原樣往上拋，交給全域錯誤處理回 500。 */
function toAppError(err: unknown): unknown {
  if (err instanceof CouponValidationError) return new AppError(err.message, 'VALIDATION_ERROR', 400);
  if (err instanceof CouponLockedError) return new AppError(err.message, 'COUPON_LOCKED', 409, { fields: err.fields });
  if (err instanceof CouponConflictError) return new AppError(err.message, 'CONFLICT', 409);
  return err;
}

/** tenantHandler 加上 service 錯誤的轉換 */
function couponHandler(
  app: FastifyInstance,
  fn: (request: FastifyRequest, reply: TenantReply, ctx: TenantCtx) => Promise<unknown>,
) {
  return tenantHandler(app, async (request, reply, ctx) => {
    try {
      return await fn(request, reply, ctx);
    } catch (err) {
      throw toAppError(err);
    }
  });
}

/** 查無資料等非例外的失敗：設定狀態碼並回傳錯誤內容（交易照常提交，沒有寫入要回滾） */
function fail(reply: TenantReply, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  reply.code(status);
  return { success: false, error: { code, message, ...extra } };
}

export default async function couponRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: [requirePermission('coupon.view')] }, couponHandler(app, async (request, _reply, ctx) => {
    const query = listQuerySchema.parse(request.query);
    const result = await listCoupons(ctx, query);
    return {
      success: true,
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit, statusCounts: result.statusCounts },
    };
  }));

  app.get('/:id', { preHandler: [requirePermission('coupon.view')] }, couponHandler(app, async (request, reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const coupon = await getCoupon(ctx, id);
    if (!coupon) return fail(reply, 404, 'NOT_FOUND', '查無此券');
    return { success: true, data: coupon };
  }));

  app.post('/', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, _reply, ctx) => {
    const coupon = await createCoupon(ctx, request.agent.id, couponInputSchema.parse(request.body));
    return { success: true, data: coupon };
  }));

  app.patch('/:id', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const coupon = await updateCoupon(ctx, id, couponInputSchema.parse(request.body));
    if (!coupon) return fail(reply, 404, 'NOT_FOUND', '查無此券');
    return { success: true, data: coupon };
  }));

  /** 複製為新草稿，回傳新券（前端導向其編輯頁）。 */
  app.post('/:id/duplicate', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const copy = await duplicateCoupon(ctx, id, request.agent.id);
    if (!copy) return fail(reply, 404, 'NOT_FOUND', '查無此券');
    return { success: true, data: copy };
  }));

  /** 共用碼即時檢查（表單失焦時呼叫）。excludeId 為正在編輯的券，自己不算重複。 */
  app.get('/shared-code/check', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, _reply, ctx) => {
    const { code, excludeId } = z
      .object({ code: z.string().min(1), excludeId: z.string().uuid().optional() })
      .parse(request.query);
    const result = await checkSharedCode(ctx, code, excludeId);
    return { success: true, data: result };
  }));

  app.delete('/:id', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const result = await deleteCoupon(ctx, id);
    if (!result.deleted) {
      if (result.reason === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND', '查無此券');
      return fail(reply, 409, 'NOT_DRAFT', '已發布的券無法刪除，請改為提前結束');
    }
    return { success: true };
  }));

  // 狀態流轉。分成獨立端點而非 PATCH status，讓權限與稽核能對應到具體動作。
  // 路徑須寫成字串字面值：部署前的 OpenAPI 產生器（openapi-inventory.mjs）只認得字面值路徑
  const transition = (next: 'ACTIVE' | 'PAUSED' | 'ENDED') =>
    couponHandler(app, async (request, reply, ctx) => {
      const { id } = idParams.parse(request.params);
      // 在同一個交易內鎖券、改狀態、作廢未使用的券
      const result = await changeStatus(ctx, id, next);
      if (!result.ok) {
        if (result.reason === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND', '查無此券');
        return fail(reply, 409, 'INVALID_TRANSITION', result.reason);
      }
      // 提前結束時帶回已領取與未使用張數，供後台提示影響範圍
      const { ok: _ok, ...data } = result;
      return { success: true, data };
    });
  app.post('/:id/publish', { preHandler: [requirePermission('coupon.manage')] }, transition('ACTIVE'));
  app.post('/:id/pause', { preHandler: [requirePermission('coupon.manage')] }, transition('PAUSED'));
  app.post('/:id/resume', { preHandler: [requirePermission('coupon.manage')] }, transition('ACTIVE'));
  app.post('/:id/end', { preHandler: [requirePermission('coupon.manage')] }, transition('ENDED'));

  /**
   * 批次發券。每 ISSUE_BATCH_SIZE 人一個交易（交易時限 5 秒）；已提交的批次不會因後面的批次失敗而回滾。
   * 第一批就失敗時回錯誤；之後的批次失敗時回已發出的結果，並以 stopped 告知停在哪裡、原因為何。
   */
  app.post('/:id/issue', { preHandler: [requirePermission('coupon.issue')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = issueSchema.parse(request.body);
    const tenantId = request.agent.tenantId;
    const merged: IssueResult = { issued: [], skipped: [] };
    let stopped: { message: string; notAttempted: string[] } | undefined;
    for (let start = 0; start < body.contactIds.length; start += ISSUE_BATCH_SIZE) {
      const batch = body.contactIds.slice(start, start + ISSUE_BATCH_SIZE);
      try {
        const result = await inTenant(app.prisma, tenantId, (ctx) =>
          issueCoupons(ctx, id, {
            contactIds: batch,
            // 這個端點不送訊息，只給系統整合使用；沒帶時記為 api，不能算成對話發券
            issuedVia: body.issuedVia ?? COUPON_ISSUED_VIA.API,
            issuedRefId: body.issuedRefId ?? request.agent.id,
          }));
        merged.issued.push(...result.issued);
        merged.skipped.push(...result.skipped);
      } catch (err) {
        if (start === 0) throw toAppError(err);
        const reason = toAppError(err);
        stopped = {
          message: reason instanceof AppError ? reason.message : '發券中途失敗，其餘對象未發出',
          notAttempted: body.contactIds.slice(start),
        };
        if (!(reason instanceof AppError)) request.log.error({ err }, '[Coupon] 批次發券中途失敗');
        break;
      }
    }
    return { success: true, data: stopped ? { ...merged, stopped } : merged };
  });

  // ── 券詳情頁「發送給…」：建立一則附券廣播（發放方式 batch），由排程在背景發送（design D31）──

  /** 送出前預覽：可送達人數、剩餘名額與已達每人上限的人數 */
  app.post('/:id/batch-issue/preview', { preHandler: [requirePermission('coupon.issue')] }, couponHandler(app, async (request, _reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const body = batchAudienceSchema.parse(request.body ?? {});
    await assertChannelVisible(request, body.channelId, 'reply_only');
    const result = await previewBroadcastAudience(ctx.tx, ctx.tenantId, {
      channelId: body.channelId,
      targetType: body.targetType,
      segmentId: body.segmentId,
      targetConfig: { tagIds: body.tagIds, contactIds: body.contactIds },
      couponId: id,
      // 批次發放允許客服補償券（design D31），檢查與建立時相同
      couponIssuedVia: COUPON_ISSUED_VIA.BATCH,
    });
    return { success: true, data: { ...result, maxRecipients: BATCH_ISSUE_MAX_RECIPIENTS } };
  }));

  /** 只需要 coupon.issue：券頁建立的廣播只能帶這張券與發券文字，不能選素材 */
  app.post('/:id/batch-issue', { preHandler: [requirePermission('coupon.issue')] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = batchIssueSchema.parse(request.body ?? {});
    await assertChannelVisible(request, body.channelId, 'reply_only');
    let result;
    try {
      result = await createBatchIssueFlow(app, request.agent.tenantId, request.agent.id, id, body);
    } catch (err) {
      throw toAppError(err);
    }
    return reply.code(202).send({ success: true, data: result });
  });

  /** 這張券的附券廣播與批次發放紀錄（新到舊），附發券張數與跳過、失敗原因 */
  app.get('/:id/batch-issues', { preHandler: [requirePermission('coupon.view')] }, couponHandler(app, async (request, _reply, ctx) => {
    const { id } = idParams.parse(request.params);
    return { success: true, data: await listCouponBroadcasts(ctx, id) };
  }));

  // ── 序號包匯入 ──

  app.post('/:id/codes/preview', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, _reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const body = codesSchema.parse(request.body ?? {});
    const result = await previewImport(ctx, body.codes, id);
    return { success: true, data: result };
  }));

  app.post('/:id/codes', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, _reply, ctx) => {
    const { id } = idParams.parse(request.params);
    const body = codesSchema.parse(request.body ?? {});
    const result = await importCodes(ctx, id, body.codes);
    return { success: true, data: result };
  }));

  app.delete('/:id/codes/:code', { preHandler: [requirePermission('coupon.manage')] }, couponHandler(app, async (request, reply, ctx) => {
    const { id, code } = idParams.extend({ code: z.string().min(1).max(64) }).parse(request.params);
    const result = await removeAvailableCode(ctx, id, code);
    if (!result.removed) {
      if (result.reason === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND', '查無此序號');
      return fail(reply, 409, 'ALREADY_ASSIGNED', '此序號已配發給顧客，無法移除');
    }
    return { success: true };
  }));

  // 核銷台。掃碼或手動輸入券號皆走此端點；成功時 flow 推播券狀態更新（commit 後送出）
  app.post('/redeem', { preHandler: [requirePermission('coupon.redeem')] }, async (request, reply) => {
    const body = redeemSchema.parse(request.body ?? {});
    if (!body.code && !body.instanceId) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: '請提供券號' } });
    const result = await redeemAtConsole({ prisma: app.prisma, io: app.io }, request.agent.tenantId, {
      code: body.code,
      instanceId: body.instanceId,
      staffCode: body.staffCode,
      redeemedBy: request.agent.id,
      redeemChannel: 'staff_console',
    });
    if (!result.ok) {
      // 失敗原因逐一對應訊息——店員需要知道為什麼不能用，不是只知道失敗
      const messages: Record<string, string> = {
        NOT_FOUND: '查無此券',
        ALREADY_REDEEMED: '此券已使用',
        EXPIRED: '此券已過期',
        NOT_YET_VALID: '此券尚未生效',
        NOT_OPENED: '顧客尚未開啟這張券，請顧客先在手機上開啟',
        REVOKED: '此券已作廢',
        NOT_CLAIMED: '此券尚未領取',
        STAFF_CODE_REQUIRED: '請輸入店員驗證碼',
        STAFF_CODE_MISMATCH: '店員驗證碼不正確',
        SELF_REDEEM_NOT_ALLOWED: '此券須由店員核銷',
        CONFLICT: '此券剛被核銷，請重新確認',
      };
      return reply.code(409).send({
        success: false,
        error: {
          code: result.reason,
          message: messages[result.reason] ?? '核銷失敗',
          redeemedAt: 'redeemedAt' in result ? result.redeemedAt : undefined,
        },
      });
    }
    return reply.send({ success: true, data: result });
  });
}
