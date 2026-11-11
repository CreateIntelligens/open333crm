/**
 * 記錄加入好友（add-coupon-system A15 15.15；design D28；spec automation-engine「記錄加入好友的次數」）。
 *
 * 渠道外掛把加入好友事件解析成 contentType 'follow' 的入站訊息（目前只有 LINE 會送出）。
 * 每次加入都更新最後一次加入時間與次數；firstFollowedAt 沒有值時才是第一次加入。
 * 上線前就存在的 LINE 渠道身分由 migration 回填 firstFollowedAt = linkedAt，封鎖後再加入不算第一次。
 *
 * 第一次加入的判斷用條件式更新（WHERE firstFollowedAt IS NULL）：同一位顧客的兩個 follow 同時處理時，
 * 只有一個會更新到這一列，加好友禮不會發兩次。
 */
import { logger } from '@open333crm/core';
import type { InboundMessageContext } from './inbound-message.types.js';

export const FOLLOW_CONTENT_TYPE = 'follow';

export async function recordInboundFollow(ctx: InboundMessageContext): Promise<void> {
  if (ctx.contentType !== FOLLOW_CONTENT_TYPE) return;

  const where = {
    channelId: ctx.channel.id,
    uid: ctx.contactUid,
    contact: { tenantId: ctx.tenantId },
  };
  try {
    const first = await ctx.prisma.channelIdentity.updateMany({
      where: { ...where, firstFollowedAt: null },
      data: { firstFollowedAt: ctx.now, lastFollowedAt: ctx.now, followCount: { increment: 1 } },
    });
    if (first.count === 0) {
      await ctx.prisma.channelIdentity.updateMany({
        where,
        data: { lastFollowedAt: ctx.now, followCount: { increment: 1 } },
      });
    }
    ctx.isFirstFollow = first.count > 0;
  } catch (err) {
    // 記錄失敗時不擋訊息落地與其他處理；當成「不是第一次加入」（加好友禮不發，寧可少發不重複發）。
    // 加入事件本身已存成收件匣訊息，客服仍看得到顧客加入
    logger.error('[Webhook] 記錄加入好友失敗，這次不算第一次加入', {
      tenantId: ctx.tenantId,
      channelId: ctx.channel.id,
      err,
    });
    ctx.isFirstFollow = false;
  }
}
