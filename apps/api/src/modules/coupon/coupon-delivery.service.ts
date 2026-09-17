/**
 * 發券訊息組裝與送出（OpenSpec design D7／D10）。
 *
 * 券的內容全部在票券頁，**對話中送出的只是一則帶連結的入口訊息**——
 * 不做專屬的 Flex 券卡版型。因此本檔的職責是：組連結、組文案、選發送策略，
 * 實際送出交給既有的 deliverToChannel（SafeReply 降級已內建）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { getConfig } from '../../config/env.js';
import { withTenant } from '../../lib/tenant-db.js';
import { deliverToChannel } from '../conversation/conversation.service.js';

export type DeliveryStrategy = 'reply' | 'push';

export interface CouponMessageParams {
  couponName: string;
  /** 帶憑證者為領取連結；已歸戶者直接連到券夾 */
  claimToken: string | null;
  instanceId: string;
  /** FB／IG 需額外提示勿轉發（憑證即所有權，design D10） */
  warnForwarding: boolean;
}

/**
 * 組票券頁網址。
 *
 * 第一階段是一般網頁（Account Link 認證），第二階段改 LIFF 時只需換這個
 * 函式的輸出，訊息組裝與發送邏輯不動（design D11）。
 */
export function buildCouponUrl(params: { claimToken: string | null; instanceId: string }): string {
  const base = getConfig().WEB_BASE_URL.replace(/\/$/, '');
  return params.claimToken
    ? `${base}/coupon/claim/${encodeURIComponent(params.claimToken)}`
    : `${base}/coupon/${encodeURIComponent(params.instanceId)}`;
}

/**
 * 組發券訊息。純文字加連結——各渠道都支援，不依賴特定版型能力。
 *
 * ⚠️ 勿轉發的提示不是客套話：FB／IG 的領取憑證被轉發，別人就能領走
 * （design D10 已接受此取捨），文案是唯一的使用者側緩解。
 */
export function buildCouponMessage(params: CouponMessageParams): string {
  const url = buildCouponUrl(params);
  const lines = [
    `為您準備了一張優惠券：${params.couponName}`,
    '',
    params.claimToken ? '點擊以下連結領取：' : '點擊以下連結查看：',
    url,
  ];
  if (params.warnForwarding) {
    lines.push('', '※ 此連結專屬於您，請勿轉發給他人。');
  }
  return lines.join('\n');
}

/** FB／IG 沒有可信的平台身分，發出的券一律需要領取憑證（design D10）。 */
export function requiresClaimToken(channelType: string): boolean {
  return channelType !== CHANNEL_TYPE.LINE;
}

export interface SendCouponParams {
  tenantId: string;
  conversationId: string;
  couponName: string;
  claimToken: string | null;
  instanceId: string;
  channelType: string;
  /**
   * 發送策略（design D7）：
   * - reply：關鍵字／加好友觸發，免費但 replyToken 效期短（約 1 分鐘）須立即送出
   * - push：客服主動發券，當下通常已無有效 replyToken
   */
  strategy?: DeliveryStrategy;
  replyToken?: string;
  /** ISO 字串，與 ChannelDeliveryOptions 一致 */
  receivedAt?: string;
}

/**
 * 送出發券訊息。失敗不拋錯——發券本身已成功入庫，訊息沒送到是可補救的次要問題，
 * 讓整個發券流程因此失敗反而更糟（券已建立卻回報失敗，座席會重發造成重複）。
 */
export async function sendCouponMessage(
  prisma: PrismaClient,
  params: SendCouponParams,
): Promise<{ sent: boolean; reason?: string }> {
  const text = buildCouponMessage({
    couponName: params.couponName,
    claimToken: params.claimToken,
    instanceId: params.instanceId,
    warnForwarding: params.claimToken != null,
  });

  try {
    await withTenant(prisma, params.tenantId, (tx) =>
      deliverToChannel(tx, params.conversationId, {
        contentType: 'text',
        content: {
          text,
          // strategy 放 content 內，與既有 deliverToChannel 的讀取位置一致
          ...(params.strategy ? { strategy: params.strategy } : {}),
        },
        delivery: {
          replyToken: params.replyToken,
          receivedAt: params.receivedAt,
        },
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
