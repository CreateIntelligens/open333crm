/**
 * 附券廣播與券詳情頁批次發券的前端規則（add-coupon-system design D29、D31）。
 * 廣播頁與券詳情頁共用：名額警示、跳過與失敗原因的顯示文字。
 */

/** 預覽回應（POST /marketing/broadcasts/audience-preview、/coupons/:id/batch-issue/preview） */
export interface CouponAudiencePreview {
  matched?: number;
  reachable: number;
  messagingWindowHours?: number | null;
  coupon?: { remaining: number | null; limitReached: number };
  maxRecipients?: number;
}

/** 附券廣播的結果（後端 getCouponBroadcastSummary） */
export interface CouponBroadcastSummary {
  issued: number;
  pending: number;
  skipped: Record<string, number>;
  failed: Record<string, number>;
}

/**
 * 受眾大於剩餘名額時的警示：依名單順序發到名額用完，其餘跳過。已達每人上限的人本來就拿不到，不算在內。
 * 沒有發行總量（remaining 為 null）或名額足夠時回 null。
 */
export function couponCapacityWarning(preview: Pick<CouponAudiencePreview, 'reachable' | 'coupon'> | null): string | null {
  const remaining = preview?.coupon?.remaining;
  if (!preview?.coupon || remaining == null) return null;
  const eligible = Math.max(0, preview.reachable - preview.coupon.limitReached);
  if (eligible <= remaining) return null;
  return `剩餘名額 ${remaining} 張，可拿券的 ${eligible} 人中有 ${eligible - remaining} 人拿不到。會依名單順序發到名額用完，其餘的人不會收到訊息。`;
}

/** 跳過與失敗原因的顯示文字（後端的原因代碼） */
const REASON_LABELS: Record<string, string> = {
  TOTAL_LIMIT_REACHED: '發行總量已發完',
  PER_CONTACT_LIMIT_REACHED: '已達每人上限',
  CODES_EXHAUSTED: '序號已用完',
  SHARED_CODE_MISSING: '共用碼未設定',
  CODE_GENERATION_FAILED: '券號產生失敗',
  CODE_ALLOCATION_CONFLICT: '序號配發衝突',
  COUPON_EXPIRED: '券已過到期日',
  CONTACT_NOT_FOUND: '聯絡人不存在',
  NO_CHANNEL_IDENTITY: '沒有這個渠道的身分',
  OUTSIDE_MESSAGING_WINDOW: '超過 24 小時沒有傳訊息',
  DELIVERY_FAILED: '訊息送不出（顧客可能已封鎖）',
  COUPON_MESSAGE_FAILED: '素材已送達，優惠券訊息送不出',
  LINK_FAILED: '票券連結產生失敗',
  CONFIRM_TOO_LATE: '訊息已送出，但券在確認前已作廢',
  DELIVERED_UNCONFIRMED: '訊息已送出，但系統沒有記錄成功',
  INTERRUPTED: '發送中斷，無法確認是否送達（不重送，券已作廢）',
};

export function couponBroadcastReasonLabel(code: string | null | undefined): string {
  return (code && REASON_LABELS[code]) || '其他原因';
}

export interface CouponResultLine {
  kind: 'issued' | 'pending' | 'skipped' | 'failed';
  label: string;
  count: number;
}

/** 結果的每一列：發券張數，再依原因分列跳過與失敗人數（人數為 0 的不列） */
export function couponResultLines(summary: CouponBroadcastSummary): CouponResultLine[] {
  const lines: CouponResultLine[] = [{ kind: 'issued', label: '發券', count: summary.issued }];
  if (summary.pending > 0) lines.push({ kind: 'pending', label: '發送中', count: summary.pending });
  for (const [code, count] of Object.entries(summary.skipped)) {
    if (count > 0) lines.push({ kind: 'skipped', label: `因${couponBroadcastReasonLabel(code)}跳過`, count });
  }
  for (const [code, count] of Object.entries(summary.failed)) {
    if (count > 0) lines.push({ kind: 'failed', label: couponBroadcastReasonLabel(code), count });
  }
  return lines;
}

/** 附券廣播與批次發放失敗代碼的補充說明（廣播的 failureReason 已是中文，這裡只補行動建議） */
export const COUPON_BROADCAST_FAILURE_HINTS: Record<string, string> = {
  LINE_QUOTA_INSUFFICIENT: '可到 LINE Official Account Manager 提高本月訊息額度，或縮小對象後重新發送。',
  COUPON_NOT_ACTIVE: '請先恢復發放這張券，再重新發送；已處理的人不會重複收到。',
  COUPON_EXPIRED: '到期日已過的券不能再發，請改附其他券建立新的廣播。',
};

/** 券詳情頁批次發放的人數上限（與後端 BATCH_ISSUE_MAX_RECIPIENTS 相同） */
export const BATCH_ISSUE_MAX_RECIPIENTS = 1000;

/** 能主動推送訊息、可以附券廣播與批次發券的渠道（網站客服沒有主動推送） */
export const COUPON_PUSH_CHANNEL_TYPES = ['LINE', 'FB', 'THREADS'];
