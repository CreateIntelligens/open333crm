/**
 * 建立廣播與受眾分群表單的檢查（change fix-broadcast-audience-fail-closed）。
 * 後端也會擋（fail-closed），前端先擋是為了讓使用者在送出前就知道缺什麼。
 */

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

/**
 * 受眾選項。「手動選擇」目前沒有挑選聯絡人的介面，先不提供，
 * 避免送出空名單（後端會拒絕）。
 */
export const BROADCAST_TARGET_OPTIONS = [
  { value: 'all', label: '全部聯絡人' },
  { value: 'segment', label: '受眾分群' },
  { value: 'tags', label: '依標籤篩選' },
];

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
