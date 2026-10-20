/**
 * 領券自動貼標。發券（LINE 直接歸戶）與領取（FB／IG 憑證換券）兩條路徑共用。
 */
import type { Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import { addTagToTarget } from '../tag/tagging.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 依券設定貼標；設了標籤時效就寫入到期時間，交給 tag-expiry 排程移除。
 * 貼標失敗不影響發券或領取——標籤是行銷輔助，券才是顧客要的東西。
 */
export async function applyClaimTag(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
  coupon: { claimTagId: string | null; claimTagTtlDays: number | null },
): Promise<void> {
  if (!coupon.claimTagId) return;
  try {
    await addTagToTarget(tx, {
      tenantId,
      targetType: 'CONTACT',
      targetId: contactId,
      tagId: coupon.claimTagId,
      // 非人工路徑，標記來源為 system 以便日後區分
      addedBy: 'system',
      expiresAt: coupon.claimTagTtlDays ? new Date(Date.now() + coupon.claimTagTtlDays * DAY_MS) : null,
    });
  } catch (err) {
    logger.warn('[Coupon] 領券貼標失敗（不影響發券與領取）', {
      tenantId,
      contactId,
      tagId: coupon.claimTagId,
      error: (err as Error).message,
    });
  }
}
