/**
 * 發券訊息送出（design D7）。訊息內容（券名＋票券連結）由 @open333crm/core 的 buildCouponMessage 組成，
 * API 與 workers 共用同一套文案；這裡只負責交給既有的 deliverToChannel（SafeReply 降級已內建）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { deliverToChannel } from '../conversation/conversation.service.js';

/**
 * 送出發券訊息。失敗不拋錯——發券本身已成功入庫，訊息沒送到是可補救的次要問題，
 * 讓整個發券流程因此失敗反而更糟（券已建立卻回報失敗，座席會重發造成重複）。
 * 座席主動發券時對話的 replyToken 多半已失效，固定走 push（design D7）。
 */
export async function sendCouponText(
  prisma: PrismaClient,
  params: { tenantId: string; conversationId: string; text: string },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    await withTenant(prisma, params.tenantId, (tx) =>
      deliverToChannel(tx, params.conversationId, {
        contentType: 'text',
        content: { text: params.text, strategy: 'push' },
      }));
    return { sent: true };
  } catch (err) {
    logger.error('[Coupon] 發券訊息送出失敗', {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      error: (err as Error).message,
    });
    return { sent: false, reason: (err as Error).message };
  }
}
