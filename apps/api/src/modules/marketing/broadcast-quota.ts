/**
 * 群發發送前的訊息額度檢查（附券廣播與一般群發共用；change fix-plain-broadcast-send-362 design D4）。
 *
 * 只對渠道外掛有 `extensions.analytics.getMessageQuota` 的渠道檢查（依外掛能力，不判斷渠道類型，AGENTS.md 結構規則 5）。
 * 剩餘額度小於這次要送出的人數時整則不送；查不到額度時也不送。同一位收件人一次推送多則只算一次。
 */
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';

export interface QuotaRejection {
  code: 'LINE_QUOTA_CHECK_FAILED' | 'LINE_QUOTA_INSUFFICIENT';
  reason: string;
}

/**
 * 檢查渠道本月剩餘訊息額度夠不夠送給 needed 人；夠（或渠道沒有額度概念）時回 null。
 * withCoupon 為附券廣播：原因多說明沒有發出任何券。
 */
export async function checkBroadcastQuota(
  plugin: ChannelPlugin,
  credentials: Record<string, unknown>,
  needed: number,
  opts: { withCoupon: boolean; log: Record<string, unknown> },
): Promise<QuotaRejection | null> {
  const quotaOf = plugin.extensions?.analytics?.getMessageQuota;
  if (needed <= 0 || !quotaOf) return null;
  let quota: { totalUsage: number; maxMessages?: number };
  try {
    quota = await quotaOf(credentials);
  } catch (err) {
    logger.error('[Broadcast] 查詢訊息額度失敗', { ...opts.log, error: (err as Error).message });
    return { code: 'LINE_QUOTA_CHECK_FAILED', reason: '無法查詢官方帳號本月的訊息額度，沒有發送。請稍後重新發送' };
  }
  if (quota.maxMessages === undefined || quota.maxMessages - quota.totalUsage >= needed) return null;
  const left = Math.max(0, quota.maxMessages - quota.totalUsage);
  const notSent = opts.withCoupon ? '沒有發送也沒有發出任何券' : '沒有發送';
  return {
    code: 'LINE_QUOTA_INSUFFICIENT',
    reason: `官方帳號本月剩餘訊息額度 ${left} 則，少於這次要發送的 ${needed} 人，${notSent}。請提高額度或縮小對象後重新發送`,
  };
}
