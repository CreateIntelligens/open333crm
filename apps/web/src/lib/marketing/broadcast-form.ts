/**
 * 建立廣播與受眾分群表單的檢查（change fix-broadcast-audience-fail-closed）。
 * 後端也會擋（fail-closed），前端先擋是為了讓使用者在送出前就知道缺什麼。
 */

import { bodyHasCouponUrl, COUPON_URL_NEEDS_COUPON_MESSAGE } from './coupon-url';

/** 渠道列舉（LINE / FB）對應素材的 channelType（line / fb）；其他渠道沒有素材可廣播 */
export function materialChannelKey(channelType: string | undefined | null): 'line' | 'fb' | '' {
  switch ((channelType ?? '').toUpperCase()) {
    case 'LINE':
      return 'line';
    case 'FB':
      return 'fb';
    default:
      return '';
  }
}

/** 渠道類型的顯示名稱：畫面不顯示 THREADS、FB 等內部代碼（change add-fb-ig-keyword-coupon） */
const CHANNEL_TYPE_LABELS: Record<string, string> = {
  LINE: 'LINE',
  FB: 'Facebook',
  THREADS: 'Instagram',
  WEBCHAT: '網站客服',
};

export function channelTypeLabel(channelType: string | undefined | null): string {
  const key = (channelType ?? '').toUpperCase();
  return CHANNEL_TYPE_LABELS[key] ?? (channelType ?? '');
}

/** 渠道選單的選項文字，例如「IG（Instagram）」 */
export function channelOptionLabel(channel: { displayName: string; channelType: string }): string {
  return `${channel.displayName}（${channelTypeLabel(channel.channelType)}）`;
}

/** Instagram 沒有素材（素材庫只有 line、fb），廣播只能附券送出預設的發券文字 */
export const INSTAGRAM_BROADCAST_NOTICE =
  'Instagram 沒有可用的素材，只能附上優惠券、送出預設的發券文字；只會送給 24 小時內傳過訊息給 IG 帳號的人';

/**
 * 廣播的訊息來源缺漏時回傳提示文字：沒有素材也沒有附券不能建立（與後端 createBroadcastSchema 一致，
 * 沒有舊版型時素材與優惠券至少一個）。Instagram 沒有素材，只能附券。
 */
export function broadcastSourceError(
  channelType: string | undefined | null,
  form: { materialId: string; couponId: string },
  /** 所選素材的 body；含 {{coupon.url}} 時要附券（change improve-coupon-url-insert-ux，與後端 MATERIAL_NEEDS_COUPON 一致） */
  materialBody?: unknown,
): string | null {
  if (form.materialId && !form.couponId && bodyHasCouponUrl(materialBody)) return COUPON_URL_NEEDS_COUPON_MESSAGE;
  if (form.materialId || form.couponId) return null;
  if ((channelType ?? '').toUpperCase() === 'THREADS') return 'Instagram 廣播要附上優惠券才能建立';
  return '請選擇素材或附上優惠券';
}

/**
 * 受眾選項。「手動選擇」目前沒有挑選聯絡人的介面，先不提供，
 * 避免送出空名單（後端會拒絕）。
 */
export const BROADCAST_TARGET_OPTIONS = [
  { value: 'all', label: '全部聯絡人' },
  { value: 'segment', label: '受眾分群' },
  { value: 'tags', label: '依標籤篩選' },
];

/**
 * 有 24 小時訊息視窗的渠道（FB、IG），與後端 plugin 的 messagingWindowHours 一致
 * （change broadcast-messaging-window）。
 */
export const MESSAGING_WINDOW_CHANNEL_TYPES = ['FB', 'THREADS'];

export function hasMessagingWindow(channelType: string | undefined | null): boolean {
  return MESSAGING_WINDOW_CHANNEL_TYPES.includes((channelType ?? '').toUpperCase());
}

/**
 * 依渠道給受眾選項。FB／IG 只能發給 24 小時內傳過訊息的人，人數本來就少，
 * 不提供分群與標籤，避免讓人以為可以像 LINE 一樣分眾群發。
 */
export function broadcastTargetOptions(channelType: string | undefined | null) {
  return hasMessagingWindow(channelType)
    ? [{ value: 'all', label: '24 小時內傳過訊息的人' }]
    : BROADCAST_TARGET_OPTIONS;
}

export const BROADCAST_TARGET_LABELS: Record<string, string> = {
  all: '全部',
  segment: '分群',
  tags: '標籤',
  contacts: '指定聯絡人',
};

/** 受眾欄位缺漏時回傳提示文字，完整時回傳 null */
export function broadcastAudienceError(form: {
  targetType: string;
  segmentId: string;
  tagIds: string[];
}): string | null {
  if (form.targetType === 'segment' && !form.segmentId) return '請選擇一個分群';
  if (form.targetType === 'tags' && form.tagIds.length === 0) return '請至少選擇一個標籤';
  if (form.targetType === 'contacts') return '目前不支援手動選擇聯絡人';
  return null;
}

/** 分群條件：至少一條，且每條都要有值 */
export function segmentConditionsError(conditions: Array<{ value: string }>): string | null {
  if (conditions.length === 0) return '至少要有一條條件';
  if (conditions.some((c) => !c.value || !c.value.trim())) return '每條條件都要選擇或填入值';
  return null;
}
