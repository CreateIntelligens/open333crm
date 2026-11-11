/**
 * 領券自動貼標，只有批次發券（coupon.flow.ts 經 issueCoupons）呼叫。
 * 對話發券、傳訊領券、附券廣播傳 skipClaimTag，送出確認時才由 @open333crm/core 的 confirmPendingInstance 貼標。
 */
import { logger, mergeClaimTagExpiry } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { addTagToTarget, type ContactTagged } from '../tag/tagging.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 依券設定貼標；設了標籤時效就寫入到期時間，交給 tag-expiry 排程移除。
 * 貼標失敗不影響發券或領取——標籤是行銷輔助，券才是顧客要的東西。
 * 回傳這次貼上的標籤（失敗或沒有設定時回傳 null），flow 用它送出 contact.tagged。
 */
export async function applyClaimTag(
  ctx: TenantCtx,
  contactId: string,
  coupon: { claimTagId: string | null; claimTagTtlDays: number | null },
): Promise<ContactTagged | null> {
  if (!coupon.claimTagId) return null;
  const { tx, tenantId } = ctx;
  // 貼標失敗不能拖垮發券：Postgres 交易內任何 SQL 錯誤都會讓整個交易失效，catch 擋不住，
  // 所以在 savepoint 內執行，失敗時只回滾這一段
  await tx.$executeRawUnsafe('SAVEPOINT coupon_claim_tag');
  try {
    const existing = await tx.contactTag.findUnique({
      where: { contactId_tagId: { contactId, tagId: coupon.claimTagId } },
      select: { expiresAt: true },
    });
    const assignment = await addTagToTarget(ctx, {
      targetType: 'CONTACT',
      targetId: contactId,
      tagId: coupon.claimTagId,
      // 非人工路徑，標記來源為 system 以便日後區分
      addedBy: 'system',
      // 已是永久的維持永久、有期限的取較晚者（手動貼的 VIP 不會被改成會到期）
      expiresAt: mergeClaimTagExpiry(
        existing ? existing.expiresAt : undefined,
        coupon.claimTagTtlDays ? new Date(Date.now() + coupon.claimTagTtlDays * DAY_MS) : null,
      ),
    });
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT coupon_claim_tag');
    return { contactId, tagId: coupon.claimTagId, tagName: assignment.tag.name, source: 'system' };
  } catch (err) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT coupon_claim_tag');
    logger.warn('[Coupon] 領券貼標失敗（不影響發券與領取）', {
      tenantId,
      contactId,
      tagId: coupon.claimTagId,
      error: (err as Error).message,
    });
    return null;
  }
}
