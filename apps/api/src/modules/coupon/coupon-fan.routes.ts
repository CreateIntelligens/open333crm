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
import { z } from 'zod';
import { verifyFanToken, type FanPayload } from '../portal/portal-auth.service.js';
import { getBindingStore } from '../identity-binding/binding-code.js';
import { claimByToken, openInstance, redeemCoupon } from './coupon-redeem.service.js';
import { getFanCoupon, isOwnedByFan } from './coupon-fan.service.js';
import {
  getWalletQrCode,
  listWallet,
  openWalletSession,
  redeemWithStaffCode,
  startStaffCodeSession,
  type WalletDeps,
} from './coupon-wallet.service.js';

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
  REVOKED: '活動已提前結束，此券已失效',
  NOT_STAFF_CODE: '此券不是店員驗證碼券',
  CONFLICT: '此券剛被使用',
  TOO_MANY_ATTEMPTS: '驗證碼錯誤次數過多，這張券 24 小時內不能核銷。如需協助請聯絡客服。',
};

/** 券 id：格式不對直接回 400，不讓資料庫丟錯 */
const idParams = z.object({ id: z.string().uuid('券識別格式不正確') });

export default async function couponFanRoutes(app: FastifyInstance) {
  const deps = (): WalletDeps => ({ store: getBindingStore() });

  // 公開端點（票券連結換憑證）與驗證碼輸入都要防暴力嘗試
  await app.register(rateLimit, { global: true, max: 60, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  /**
   * 票券連結換顧客憑證（不需登入）。已歸戶回傳憑證；未歸戶回傳 One ID 登記頁網址；
   * 連結不存在或過期一律 410，不透露任何租戶或聯絡人資料。
   */
  app.post('/session', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1).max(100) }).parse(request.body);
    const result = await openWalletSession(app.prisma, deps(), token);
    if (result.status === 'expired') {
      return reply.status(410).send({
        success: false,
        error: { code: 'LINK_EXPIRED', message: '連結已失效，請回到對話重新點選，或到券夾查看已領取的券' },
      });
    }
    return { success: true, data: result };
  });

  /**
   * 以領取憑證換券（design D10）。FB／IG 與公開領券走此路徑。
   * 需已登入——憑證證明「這張券要給誰」，fan token 證明「你是誰」，兩者缺一不可。
   */
  app.post('/claim', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { claimToken } = z.object({ claimToken: z.string({ required_error: '缺少領取憑證' }).min(1, '缺少領取憑證').max(200) })
      .parse(request.body ?? {});

    const result = await claimByToken(app.prisma, claimToken, fan.contactId, fan.tenantId);
    if (!result.ok) {
      const messages: Record<string, string> = {
        TOKEN_NOT_FOUND: '連結無效',
        TOKEN_EXPIRED: '領取連結已過期',
        ALREADY_CLAIMED: '這張券已經被領取了',
        COUPON_INACTIVE: '此活動已結束',
        PER_CONTACT_LIMIT_REACHED: '您已領過這張券，已達每人上限',
        CONFLICT: '領取失敗，請重試',
      };
      return reply.status(409).send({
        success: false,
        error: { code: result.reason, message: messages[result.reason] ?? '領取失敗' },
      });
    }
    return { success: true, data: { instanceId: result.instanceId } };
  });

  /** 券夾：顧客名下的券（含顧客看到的狀態）與三個分頁的數量。 */
  app.get('/', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fanCoupon!;
    const { items, counts } = await listWallet(app.prisma, fan);
    return { success: true, data: items, meta: { counts } };
  });

  /** 店員掃碼券的 QR Code（data URL）。只在可使用時產生。 */
  app.get('/:id/qrcode', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);
    const result = await getWalletQrCode(app.prisma, fan, id);
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
    const result = await startStaffCodeSession(app.prisma, deps(), fan, id);
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
    const result = await redeemWithStaffCode(app.prisma, deps(), fan, id, code);
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

    const instance = await getFanCoupon(app.prisma, fan, id);
    if (!instance) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    return { success: true, data: instance };
  });

  /** 開啟券。AFTER_OPEN 模式由此刻起算效期，故是有副作用的動作，用 POST。 */
  app.post('/:id/open', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = idParams.parse(request.params);

    const result = await openInstance(app.prisma, fan.tenantId, id, fan.contactId);
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

    // 先確認這張券屬於請求者，避免以他人 instanceId 觸發核銷
    const owned = await isOwnedByFan(app.prisma, fan, id);
    if (!owned) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }

    const result = await redeemCoupon(app.prisma, fan.tenantId, {
      instanceId: id,
      selfService: true,
      redeemedBy: null,
      redeemChannel: 'fan_self',
    });
    if (!result.ok) {
      const messages: Record<string, string> = {
        ALREADY_REDEEMED: '此券已使用',
        EXPIRED: '此券已過期',
        NOT_YET_VALID: '此券尚未生效',
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
