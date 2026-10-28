/**
 * 顧客端券夾 API。Prefix: /api/v1/fan/coupons
 *
 * 身分一律來自顧客憑證（fan token），由票券連結換得，且聯絡人須已完成 One ID 歸戶驗證
 * （design D12）。**不接受請求帶 contactId** —— 那是舊 /auth 的漏洞成因。
 *
 * 第一階段在一般瀏覽器開啟（非 LIFF webview），之後改 LIFF 時
 * 這些端點不需變動，只換取得憑證的入口。
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod/v3';
import { AppError } from '../../shared/utils/response.js';
import { verifyFanToken, type FanPayload } from '../portal/portal-auth.service.js';
import { getBindingStore } from '../identity-binding/binding-code.js';
import { openInstance } from './coupon-redeem.service.js';
import { getFanCoupon } from './coupon-fan.service.js';
import { verifyLineIdToken } from './line-id-token.js';
import { MAX_DEVICE_TOKENS } from './coupon-wallet.service.js';
import {
  getWalletQrCodeFlow,
  inFanTenant,
  listWalletFlow,
  openWalletSessionFlow,
  openWalletSessionWithLineFlow,
  redeemSelfFlow,
  redeemWithStaffCodeFlow,
  requestWalletEmailCodeFlow,
  startStaffCodeSessionFlow,
  verifyWalletEmailCodeFlow,
  type WalletFlowDeps,
} from './coupon-wallet.flow.js';

export interface CouponFanRoutesOptions {
  /** 測試可注入寄開啟票券驗證碼的函式（design D24） */
  sendEmailCode?: WalletFlowDeps['sendEmailCode'];
}

const LINK_EXPIRED_MESSAGE = '連結已失效，請回到對話重新點選，或到券夾查看已領取的券';
const linkExpired = () => new AppError(LINK_EXPIRED_MESSAGE, 'LINK_EXPIRED', 410);
const walletToken = z.string().min(1).max(100);

declare module 'fastify' {
  interface FastifyRequest {
    fanCoupon?: FanPayload;
  }
}

async function authenticateFan(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '需要登入' } });
  }
  const payload = verifyFanToken(header.slice(7));
  if (!payload) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '登入已失效，請重新開啟連結' } });
  }
  request.fanCoupon = payload;
}

const STAFF_CODE_MESSAGES: Record<string, string> = {
  SESSION_REQUIRED: '請先按「立即使用」再輸入驗證碼',
  SESSION_EXPIRED: '核銷時間已結束，請返回後重新開始',
  STAFF_CODE_MISMATCH: '驗證碼錯誤，請重新輸入',
  ALREADY_REDEEMED: '此券已使用',
  EXPIRED: '此券已過期',
  NOT_YET_VALID: '此券尚未生效',
  NOT_OPENED: '請先開啟這張券再使用',
  REVOKED: '活動已提前結束，此券已失效',
  NOT_STAFF_CODE: '此券不是店員驗證碼券',
  CONFLICT: '此券剛被使用',
  TOO_MANY_ATTEMPTS: '驗證碼錯誤次數過多，這張券 24 小時內不能核銷。如需協助請聯絡客服。',
};

/** 券 id：格式不對直接回 400，不讓資料庫丟錯 */
const idParams = z.object({ id: z.string().uuid('券識別格式不正確') });

export default async function couponFanRoutes(app: FastifyInstance, opts: CouponFanRoutesOptions = {}) {
  // 交易由 coupon-wallet.flow 以顧客憑證或票券權杖的租戶開（公開端點沒有登入的座席）
  const deps = (): WalletFlowDeps => ({
    store: getBindingStore(),
    prisma: app.prisma,
    io: app.io,
    ...(opts.sendEmailCode ? { sendEmailCode: opts.sendEmailCode } : {}),
  });

  // 公開端點（票券連結換憑證）與驗證碼輸入都要防暴力嘗試
  await app.register(rateLimit, { global: true, max: 60, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  /**
   * 票券連結換顧客憑證（不需登入）。deviceTokens 是這台裝置存的裝置憑證（design D24）：
   * 已歸戶且裝置驗證過 → 回傳憑證與換新的裝置憑證；已歸戶但裝置沒驗證過 → email_code_required；
   * 未歸戶 → One ID 登記頁網址。連結不存在或過期一律 410，不透露任何租戶或聯絡人資料。
   */
  app.post('/session', async (request, reply) => {
    const { token, deviceTokens } = z
      .object({
        token: walletToken,
        deviceTokens: z.array(z.string().min(1).max(2048)).max(MAX_DEVICE_TOKENS).optional(),
      })
      .parse(request.body);
    const result = await openWalletSessionFlow(deps(), token, deviceTokens ?? []);
    if (result.status === 'expired') {
      return reply.status(410).send({
        success: false,
        error: { code: 'LINK_EXPIRED', message: LINK_EXPIRED_MESSAGE },
      });
    }
    return { success: true, data: result };
  });

  /**
   * 寄驗證碼到票券連結聯絡人原本的 email（design D24）。只給已歸戶且有 email 的聯絡人，
   * 不接受請求帶 email。同一個票券連結 10 分鐘內最多寄 3 次。
   */
  app.post('/session/code', async (request) => {
    const { token } = z.object({ token: walletToken }).parse(request.body ?? {});
    const result = await requestWalletEmailCodeFlow(deps(), token);
    switch (result.status) {
      case 'code_sent':
        return { success: true, data: result };
      case 'expired':
        throw linkExpired();
      case 'unavailable':
        throw new AppError('這張優惠券不需要 email 驗證碼，請重新開啟連結', 'EMAIL_CODE_UNAVAILABLE', 409);
      case 'in_progress':
        throw new AppError('驗證信寄送中，請稍候查看信箱', 'VERIFICATION_EMAIL_IN_PROGRESS', 409);
      case 'too_many_codes':
        throw new AppError('驗證碼寄送次數過多，請 10 分鐘後再試', 'TOO_MANY_VERIFICATION_EMAILS', 429);
      case 'send_failed':
        request.log.error('[coupon-wallet] 開啟票券的驗證信寄送失敗');
        throw new AppError('驗證信寄送失敗，請稍後再試', 'VERIFICATION_EMAIL_FAILED', 502);
    }
  });

  /** 輸入 email 驗證碼：正確回傳與 /session 的 ok 相同的資料加上裝置憑證；錯誤回剩餘次數 */
  app.post('/session/code/verify', async (request) => {
    const { token, code } = z.object({ token: walletToken, code: z.string().max(20) }).parse(request.body ?? {});
    const result = await verifyWalletEmailCodeFlow(deps(), token, code);
    switch (result.status) {
      case 'ok':
        return { success: true, data: result };
      case 'expired':
        throw linkExpired();
      case 'code_expired':
        throw new AppError('驗證碼已過期，請重新寄送', 'VERIFICATION_CODE_EXPIRED', 410);
      case 'locked':
        throw new AppError('驗證碼錯誤次數過多，請重新寄送驗證碼', 'VERIFICATION_CODE_LOCKED', 429);
      case 'invalid_code':
        throw new AppError(
          result.remainingAttempts > 0 ? `驗證碼不正確，還可以再試 ${result.remainingAttempts} 次` : '驗證碼不正確，請重新寄送驗證碼',
          'INVALID_VERIFICATION_CODE',
          400,
          { remainingAttempts: result.remainingAttempts },
        );
    }
  });

  /**
   * LINE 顧客以 LIFF 的 ID token 驗證身分（design D20）。成功後前端照一般流程呼叫 /session 開啟票券。
   * 驗證失敗或渠道沒設定時回 200 與原因，前端改走 One ID 登記；連結失效回 410。
   */
  app.post('/liff-session', async (request, reply) => {
    const { token, idToken } = z
      .object({ token: z.string().min(1).max(100), idToken: z.string().min(1).max(4096) })
      .parse(request.body ?? {});
    const result = await openWalletSessionWithLineFlow({ ...deps(), verifyLineIdToken }, token, idToken);
    if (result.status === 'expired') {
      return reply.status(410).send({
        success: false,
        error: { code: 'LINK_EXPIRED', message: '連結已失效，請回到對話重新點選，或到券夾查看已領取的券' },
      });
    }
    return { success: true, data: result };
  });

  /** 券夾：顧客名下的券（含顧客看到的狀態）與三個分頁的數量。 */
  app.get('/', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fanCoupon!;
    const { items, counts } = await listWalletFlow(deps(), fan);
    return { success: true, data: items, meta: { counts } };
  });

  /** 店員掃碼券的 QR Code（data URL）。只在可使用時產生。 */
  app.get('/:id/qrcode', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);
    const result = await getWalletQrCodeFlow(deps(), fan, id);
    if (!result.ok) {
      const messages = { NOT_FOUND: '查無此券', NOT_STAFF_SCAN: '此券不需出示 QR Code', NOT_AVAILABLE: '此券目前無法使用' };
      return reply.status(result.reason === 'NOT_FOUND' ? 404 : 409).send({
        success: false,
        error: { code: result.reason, message: messages[result.reason] },
      });
    }
    return { success: true, data: { dataUrl: result.dataUrl } };
  });

  /** 開始使用店員驗證碼券：開啟 5 分鐘的核銷時段，回傳結束時間。 */
  app.post('/:id/start', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);
    const result = await startStaffCodeSessionFlow(deps(), fan, id);
    if (!result.ok) {
      const status = result.reason === 'NOT_FOUND' ? 404 : 409;
      return reply.status(status).send({
        success: false,
        error: { code: result.reason, message: result.reason === 'NOT_FOUND' ? '查無此券' : STAFF_CODE_MESSAGES[result.reason] },
      });
    }
    return { success: true, data: { expiresAt: result.expiresAt, remainingMs: result.remainingMs } };
  });

  /** 店員在顧客手機上輸入驗證碼核銷。錯誤時回報剩餘次數，不透露正確的碼。 */
  app.post('/:id/redeem-code', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);
    const { code } = z.object({ code: z.string().regex(/^\d{4,6}$/, '需 4–6 位數字') }).parse(request.body);
    const result = await redeemWithStaffCodeFlow(deps(), fan, id, code);
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
      }
      return reply.status(409).send({
        success: false,
        error: {
          code: result.reason,
          message: STAFF_CODE_MESSAGES[result.reason] ?? '核銷失敗，請稍後再試',
          details: {
            ...(result.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : {}),
            ...(result.redeemedAt ? { redeemedAt: result.redeemedAt } : {}),
          },
        },
      });
    }
    return { success: true, data: { redeemedAt: result.redeemedAt, couponName: result.couponName } };
  });

  app.get('/:id', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);

    const instance = await inFanTenant(deps(), fan, (ctx) => getFanCoupon(ctx, fan, id));
    if (!instance) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    return { success: true, data: instance };
  });

  /** 開啟券。AFTER_OPEN 模式由此刻起算效期，故是有副作用的動作，用 POST。 */
  app.post('/:id/open', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);

    const result = await inFanTenant(deps(), fan, (ctx) => openInstance(ctx, id, fan.contactId));
    if (!result.ok && result.reason === 'NOT_FOUND') {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    if (!result.ok) {
      return reply.status(409).send({
        success: false,
        error: { code: 'CANNOT_OPEN', message: '此券目前無法開啟' },
      });
    }
    return { success: true, data: { expiresAt: result.expiresAt } };
  });

  /**
   * 顧客自助核銷。**僅當該券 redeemMode 為 SELF 時開放**，
   * 其他模式由 service 層擋下並回 403（spec：非自助券不得由顧客端核銷）。
   */
  app.post('/:id/redeem', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);

    const result = await redeemSelfFlow(deps(), fan, id);
    if (!result.ok && result.reason === 'NOT_FOUND') {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    if (!result.ok) {
      const messages: Record<string, string> = {
        ALREADY_REDEEMED: '此券已使用',
        EXPIRED: '此券已過期',
        NOT_YET_VALID: '此券尚未生效',
        NOT_OPENED: '請先開啟這張券再使用',
        REVOKED: '此券已失效',
        NOT_CLAIMED: '此券尚未領取',
        SELF_REDEEM_NOT_ALLOWED: '此券需由店員核銷',
        CONFLICT: '此券剛被使用',
      };
      const code = result.reason === 'SELF_REDEEM_NOT_ALLOWED' ? 403 : 409;
      return reply.status(code).send({
        success: false,
        error: { code: result.reason, message: messages[result.reason] ?? '核銷失敗' },
      });
    }
    return {
      success: true,
      data: { redeemedAt: result.redeemedAt, couponName: result.couponName },
    };
  });
}
