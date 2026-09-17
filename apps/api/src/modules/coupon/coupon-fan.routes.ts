/**
 * 顧客端券夾 API。Prefix: /api/v1/fan/coupons
 *
 * 身分一律來自 fan token（經 Account Link 驗證後簽發），
 * **不接受請求帶 contactId** —— 那是舊 /auth 的漏洞成因。
 *
 * 第一階段在一般瀏覽器開啟（非 LIFF webview），第二階段改 LIFF 時
 * 這些端點不需變動，只換認證入口（design D11）。
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyFanToken, type FanPayload } from '../portal/portal-auth.service.js';
import { withTenant } from '../../lib/tenant-db.js';
import { claimByToken, openInstance, redeemCoupon } from './coupon-redeem.service.js';

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

/** 顧客端看得到的券欄位。刻意不含 claimToken 與內部識別。 */
function toFanView(i: {
  id: string;
  code: string;
  status: string;
  expiresAt: Date | null;
  claimedAt: Date | null;
  openedAt: Date | null;
  redeemedAt: Date | null;
  coupon: {
    name: string; description: string | null; terms: string | null; imageUrl: string | null;
    couponType: string; discountAmount: number | null; discountPercent: number | null;
    validityMode: string; startAt: Date | null; redeemMode: string; afterOpenMinutes: number | null;
  };
}) {
  const now = new Date();
  // 未到生效日不露券號（spec：遮蔽並說明原因，不是給空白）
  const notYetValid =
    i.coupon.validityMode === 'FIXED' && i.coupon.startAt != null && i.coupon.startAt > now;

  return {
    id: i.id,
    code: notYetValid ? null : i.code,
    codeHidden: notYetValid,
    availableAt: notYetValid ? i.coupon.startAt : null,
    status: i.status,
    expiresAt: i.expiresAt,
    claimedAt: i.claimedAt,
    openedAt: i.openedAt,
    redeemedAt: i.redeemedAt,
    coupon: {
      name: i.coupon.name,
      description: i.coupon.description,
      // 條款已於儲存時消毒，此處直接輸出，不再二次轉義
      terms: i.coupon.terms,
      imageUrl: i.coupon.imageUrl,
      couponType: i.coupon.couponType,
      discountAmount: i.coupon.discountAmount,
      discountPercent: i.coupon.discountPercent,
      redeemMode: i.coupon.redeemMode,
      afterOpenMinutes: i.coupon.afterOpenMinutes,
    },
  };
}

const COUPON_INCLUDE = {
  coupon: {
    select: {
      name: true, description: true, terms: true, imageUrl: true,
      couponType: true, discountAmount: true, discountPercent: true,
      validityMode: true, startAt: true, redeemMode: true, afterOpenMinutes: true,
    },
  },
} as const;

export default async function couponFanRoutes(app: FastifyInstance) {
  /**
   * 以領取憑證換券（design D10）。FB／IG 與公開領券走此路徑。
   * 需已登入——憑證證明「這張券要給誰」，fan token 證明「你是誰」，兩者缺一不可。
   */
  app.post('/claim', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { claimToken } = request.body as { claimToken?: string };
    if (!claimToken) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: '缺少領取憑證' } });
    }

    const result = await claimByToken(app.prisma, claimToken, fan.contactId, fan.tenantId);
    if (!result.ok) {
      const messages: Record<string, string> = {
        TOKEN_NOT_FOUND: '連結無效',
        TOKEN_EXPIRED: '領取連結已過期',
        ALREADY_CLAIMED: '這張券已經被領取了',
        COUPON_INACTIVE: '此活動已結束',
        CONFLICT: '領取失敗，請重試',
      };
      return reply.status(409).send({
        success: false,
        error: { code: result.reason, message: messages[result.reason] ?? '領取失敗' },
      });
    }
    return { success: true, data: { instanceId: result.instanceId } };
  });

  /** 券夾。依狀態分流，前端據此做三分頁。 */
  app.get('/', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fanCoupon!;
    const { status } = request.query as { status?: string };

    const items = await withTenant(app.prisma, fan.tenantId, (tx) =>
      tx.couponInstance.findMany({
        where: {
          tenantId: fan.tenantId,
          contactId: fan.contactId,
          // 未領取的券不屬於任何人的券夾——它還在等人用憑證來領
          status: status
            ? (status as never)
            : { in: ['CLAIMED', 'OPENED', 'REDEEMED', 'EXPIRED'] },
        },
        include: COUPON_INCLUDE,
        orderBy: [{ expiresAt: 'asc' }, { claimedAt: 'desc' }],
      }));

    return { success: true, data: items.map(toFanView) };
  });

  app.get('/:id', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = request.params as { id: string };

    const instance = await withTenant(app.prisma, fan.tenantId, (tx) =>
      tx.couponInstance.findFirst({
        where: { id, tenantId: fan.tenantId, contactId: fan.contactId },
        include: COUPON_INCLUDE,
      }));
    if (!instance) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此券' } });
    }
    return { success: true, data: toFanView(instance) };
  });

  /** 開啟券。AFTER_OPEN 模式由此刻起算效期，故是有副作用的動作，用 POST。 */
  app.post('/:id/open', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanCoupon!;
    const { id } = request.params as { id: string };

    const result = await openInstance(app.prisma, fan.tenantId, id, fan.contactId);
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
    const { id } = request.params as { id: string };

    // 先確認這張券屬於請求者，避免以他人 instanceId 觸發核銷
    const owned = await withTenant(app.prisma, fan.tenantId, (tx) =>
      tx.couponInstance.findFirst({
        where: { id, tenantId: fan.tenantId, contactId: fan.contactId },
        select: { id: true },
      }));
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
