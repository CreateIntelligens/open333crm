/**
 * 發券的「保留 → 送出 → 確認／作廢」中，確認與作廢兩步（add-coupon-system design D16、D25）。
 *
 * 所有發券入口共用：API 的對話發券、公開領券、附券廣播（收 TenantCtx 的 `ctx.tx`），
 * 與 workers 的自動化發券（BYPASSRLS 的交易）。所以和 issueInstances 一樣，
 * 收「呼叫端開好的交易 client」與 tenantId，不自己開交易；每個查詢都自帶 tenantId，不靠 RLS 兜底。
 *
 * 保留（建立發送中的券）用 issueInstances，再把 `deliveryPendingAt` 設為當下時間；
 * 送出是外部呼叫，必須在交易外。送出成功呼叫 confirmPendingInstance，失敗呼叫 voidPendingInstance，
 * 各自在新的短交易內執行。
 */
import { logger } from '../logger/index.js';
import { applyCouponClaimTag, type CouponTx } from './issue.js';

/**
 * 作廢發送中的券：歸還序號包的序號並刪除這張券，發行總量與每人上限的名額跟著歸還。
 * 券從未送到顧客手上，不留下紀錄；只處理仍在發送中的券，已確認發出的不會被刪。
 * 回傳 true 表示這次作廢了這張券。重跑也安全（排程會作廢卡住的券）。
 */
export async function voidPendingInstance(tx: CouponTx, tenantId: string, instanceId: string): Promise<boolean> {
  // 先鎖住這張券再判斷：確認流程正在清除發送中標記時，等它提交後再看。
  // 不鎖的話，確認在「查到發送中」與「刪除」之間提交，序號會被歸還、之後再發給別人
  const pending = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM coupon_instances
    WHERE id = ${instanceId}::uuid AND "tenantId" = ${tenantId}::uuid AND "deliveryPendingAt" IS NOT NULL
    FOR UPDATE`;
  if (pending.length === 0) return false;
  await tx.couponCode.updateMany({ where: { tenantId, instanceId }, data: { status: 'AVAILABLE', instanceId: null } });
  const removed = await tx.couponInstance.deleteMany({ where: { id: instanceId, tenantId, deliveryPendingAt: { not: null } } });
  return removed.count > 0;
}

export interface ConfirmPendingParams {
  tenantId: string;
  instanceId: string;
  /** 收到券的聯絡人：領券標籤貼在這位聯絡人身上 */
  contactId: string;
  coupon: { claimTagId: string | null; claimTagTtlDays: number | null };
  now?: number;
}

export type ConfirmPendingResult =
  /** 券在確認前已被作廢（發送超過 5 分鐘，被排程作廢） */
  | { confirmed: false }
  /** tag 為這次貼上的領券標籤；呼叫端用它發出 contact.tagged 事件（API 的 flow 用 publishEvent，workers 寫 outbox） */
  | { confirmed: true; tag: { tagId: string; tagName: string } | null };

/**
 * 訊息送出成功後確認發出：清除發送中標記，再貼領券標籤。
 * 標籤在這一步才貼，送不出的券不必撤回標籤。
 * 貼標失敗不影響確認——標籤是行銷輔助，券才是顧客要的東西。
 */
export async function confirmPendingInstance(tx: CouponTx, params: ConfirmPendingParams): Promise<ConfirmPendingResult> {
  const { tenantId, instanceId, contactId, coupon } = params;
  const confirmed = await tx.couponInstance.updateMany({
    where: { id: instanceId, tenantId, deliveryPendingAt: { not: null } },
    data: { deliveryPendingAt: null },
  });
  if (confirmed.count === 0) return { confirmed: false };
  if (!coupon.claimTagId) return { confirmed: true, tag: null };

  // Postgres 交易內任何 SQL 錯誤都會讓整個交易失效，catch 擋不住，
  // 所以在 savepoint 內貼標，失敗時只回滾這一段
  await tx.$executeRawUnsafe('SAVEPOINT coupon_claim_tag');
  try {
    const tag = await applyCouponClaimTag(tx, tenantId, contactId, coupon, params.now);
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT coupon_claim_tag');
    return { confirmed: true, tag };
  } catch (err) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT coupon_claim_tag');
    logger.warn('[Coupon] 領券貼標失敗（不影響發券）', {
      tenantId,
      contactId,
      tagId: coupon.claimTagId,
      error: (err as Error).message,
    });
    return { confirmed: true, tag: null };
  }
}
