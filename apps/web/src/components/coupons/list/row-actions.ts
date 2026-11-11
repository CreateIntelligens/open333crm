/**
 * 列表每一列「⋯」選單的項目，依《優惠券後台 UX 規則》第 2 節「操作選單（依狀態不同）」。
 */
import type { CouponStatus } from '@/hooks/useCoupons';

export type RowActionKey = 'view' | 'edit' | 'pause' | 'resume' | 'end' | 'duplicate' | 'delete';

export interface RowActionDef {
  key: RowActionKey;
  label: string;
  /** 不可復原的操作用紅字 */
  destructive?: boolean;
  /** 需要 coupon.manage；沒有權限時停用（不隱藏） */
  requiresManage: boolean;
}

const DEF: Record<RowActionKey, RowActionDef> = {
  view: { key: 'view', label: '查看明細', requiresManage: false },
  edit: { key: 'edit', label: '編輯', requiresManage: true },
  pause: { key: 'pause', label: '暫停發放', requiresManage: true },
  resume: { key: 'resume', label: '恢復發放', requiresManage: true },
  end: { key: 'end', label: '提前結束', destructive: true, requiresManage: true },
  duplicate: { key: 'duplicate', label: '複製', requiresManage: true },
  delete: { key: 'delete', label: '刪除', destructive: true, requiresManage: true },
};

const BY_STATUS: Record<CouponStatus, RowActionKey[]> = {
  ACTIVE: ['view', 'edit', 'pause', 'end', 'duplicate'],
  PAUSED: ['view', 'resume', 'end', 'duplicate'],
  // 只有草稿可以刪除；已發布的券只能提前結束
  DRAFT: ['view', 'edit', 'duplicate', 'delete'],
  ENDED: ['view', 'duplicate'],
};

export function rowActionsFor(status: CouponStatus): RowActionDef[] {
  return BY_STATUS[status].map((k) => DEF[k]);
}

/** 草稿沒有成效資料可看，點列或「查看明細」都直接進編輯 */
export function couponHref(coupon: { id: string; status: CouponStatus }): string {
  return coupon.status === 'DRAFT'
    ? `/dashboard/marketing/coupons/${coupon.id}/edit`
    : `/dashboard/marketing/coupons/${coupon.id}`;
}

export const NEED_MANAGE_HINT = '需主管權限';
