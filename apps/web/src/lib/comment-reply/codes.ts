/**
 * 留言自動私訊的狀態與原因代碼對照（design D8）。
 *
 * TODO: design D8 要求代碼列舉與中文對照放 `packages/shared/src/comment-reply.ts`（前後端同源）。
 * 該檔由另一個工作項目建立，建立後這裡改成從 `@open333crm/shared` 匯入，刪掉本地常數。
 * 介面維持一致：狀態列舉、原因代碼 → 中文、未知代碼顯示通用失敗文字。
 */

export const COMMENT_REPLY_STATUSES = [
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'EXPIRED',
  'SKIPPED',
  'SKIPPED_DUPLICATE',
] as const;
export type CommentReplyStatus = (typeof COMMENT_REPLY_STATUSES)[number];

/** 狀態 pill 的文字（planning/01-ux.md §4.2） */
export const COMMENT_REPLY_STATUS_LABELS: Record<CommentReplyStatus, string> = {
  PENDING: '處理中',
  SENDING: '處理中',
  SENT: '已送出',
  FAILED: '失敗',
  EXPIRED: '已過期',
  SKIPPED: '略過',
  SKIPPED_DUPLICATE: '已私訊過',
};

/** 狀態 pill 的色彩（語意色 token） */
export const COMMENT_REPLY_STATUS_TONES: Record<CommentReplyStatus, string> = {
  PENDING: 'bg-primary-subtle text-primary',
  SENDING: 'bg-primary-subtle text-primary',
  SENT: 'bg-success-subtle text-success',
  FAILED: 'bg-destructive-subtle text-destructive',
  EXPIRED: 'bg-warning-subtle text-warning',
  SKIPPED: 'bg-muted text-muted-foreground',
  SKIPPED_DUPLICATE: 'bg-muted text-muted-foreground',
};

/** 觸發紀錄的狀態篩選（處理中涵蓋 PENDING 與 SENDING） */
export const COMMENT_REPLY_STATUS_FILTERS: Array<{ value: string; label: string; statuses: CommentReplyStatus[] }> = [
  { value: 'SENT', label: '已送出', statuses: ['SENT'] },
  { value: 'FAILED', label: '失敗', statuses: ['FAILED'] },
  { value: 'EXPIRED', label: '已過期', statuses: ['EXPIRED'] },
  { value: 'SKIPPED_DUPLICATE', label: '已私訊過', statuses: ['SKIPPED_DUPLICATE'] },
  { value: 'SKIPPED', label: '略過', statuses: ['SKIPPED'] },
  { value: 'PENDING', label: '處理中', statuses: ['PENDING', 'SENDING'] },
];

/** 原因代碼 → 一行說明（planning/01-ux.md §4.3；design D8 的完整列舉） */
export const COMMENT_REPLY_REASON_LABELS: Record<string, string> = {
  // PENDING / SENT
  RATE_LIMIT_QUEUED: '排隊中：這個帳號本小時的私訊數已達平台限速，稍後會自動送出',
  SENT_UNCONFIRMED: '可能已送達：系統中斷後重新確認時，Meta 回覆這則留言已私訊過',
  // SKIPPED
  RULE_INACTIVE: '規則在處理前被停用或刪除',
  MATERIAL_UNAVAILABLE: '素材已刪除或停用',
  MATERIAL_UNSUPPORTED: '這個素材的類型不能用於留言私訊',
  PLAN_FEATURE_DISABLED: '目前的方案未包含留言自動私訊',
  CAPABILITY_DISABLED: '平台尚未開放這項功能',
  EMERGENCY_STOPPED: '平台暫停留言自動私訊期間收到的留言',
  PLAN_QUOTA_EXCEEDED: '本月的留言私訊數已達方案上限',
  CHANNEL_INACTIVE: '渠道已停用',
  TENANT_DISABLED: '帳號已停用',
  // EXPIRED
  WINDOW_EXPIRED: '留言超過 7 天，無法再私訊',
  EXPIRED_BY_META: '留言超過 7 天，Meta 不允許再私訊',
  // FAILED
  TOKEN_EXPIRED: '粉專連結已失效',
  PERMISSION_MISSING: '粉專授權不足，無法私訊',
  APP_NOT_APPROVED: '這位顧客不在 App 的測試名單內（App 審核通過前只有測試帳號能收到）',
  USER_UNAVAILABLE: '顧客無法接收訊息（可能已封鎖粉專或關閉訊息功能）',
  COMMENT_NOT_FOUND: '留言已被刪除或隱藏，無法私訊',
  ALREADY_REPLIED: '這則留言已經私訊過（可能是在 Meta Business Suite 手動私訊的）',
  RECIPIENT_IS_PAGE: '留言者是另一個粉專，無法私訊',
  RATE_LIMITED: 'Meta 暫時限制發送次數，系統已重試仍未成功',
  NETWORK: '連不上 Meta，系統已重試仍未成功',
  UNKNOWN: '送出失敗',
};

/** 未知原因代碼的通用文字（design D8：未知代碼前端顯示通用失敗文字） */
export const UNKNOWN_REASON_LABEL = '送出失敗';

/** 詳情抽屜的建議動作種類 */
export type ReasonAction = 'reconnect' | 'editRule' | 'retry' | 'testPhaseInfo' | null;
export const COMMENT_REPLY_REASON_ACTIONS: Record<string, ReasonAction> = {
  PERMISSION_MISSING: 'reconnect',
  TOKEN_EXPIRED: 'reconnect',
  MATERIAL_UNAVAILABLE: 'editRule',
  MATERIAL_UNSUPPORTED: 'editRule',
  RATE_LIMITED: 'retry',
  NETWORK: 'retry',
  UNKNOWN: 'retry',
  APP_NOT_APPROVED: 'testPhaseInfo',
};

export function reasonLabel(code: string | null | undefined, rawMessage?: string | null): string {
  if (!code) return '';
  if (code === 'UNKNOWN' && rawMessage) return `送出失敗（Meta 回應：${rawMessage.slice(0, 100)}）`;
  return COMMENT_REPLY_REASON_LABELS[code] ?? UNKNOWN_REASON_LABEL;
}

function isKnownStatus(status: string): status is CommentReplyStatus {
  return (COMMENT_REPLY_STATUSES as readonly string[]).includes(status);
}

/**
 * 狀態 pill 的文字與色彩。PENDING＋RATE_LIMIT_QUEUED 顯示「排隊中」、
 * SENT＋SENT_UNCONFIRMED 顯示「可能已送達」（design D8 表格）。
 */
export function statusDisplay(status: string, reasonCode?: string | null): { label: string; tone: string } {
  if (status === 'PENDING' && reasonCode === 'RATE_LIMIT_QUEUED') {
    return { label: '排隊中', tone: COMMENT_REPLY_STATUS_TONES.PENDING };
  }
  if (status === 'SENT' && reasonCode === 'SENT_UNCONFIRMED') {
    return { label: '可能已送達', tone: 'bg-warning-subtle text-warning' };
  }
  if (isKnownStatus(status)) {
    return { label: COMMENT_REPLY_STATUS_LABELS[status], tone: COMMENT_REPLY_STATUS_TONES[status] };
  }
  return { label: '未知狀態', tone: 'bg-muted text-muted-foreground' };
}

/** 公開回覆子狀態（design D8） */
export const PUBLIC_REPLY_STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: '未設定',
  PENDING: '處理中',
  SENDING: '處理中',
  SENT: '已公開回覆',
  FAILED: '公開回覆失敗',
  SKIPPED: '未公開回覆',
};

export const PUBLIC_REPLY_REASON_LABELS: Record<string, string> = {
  PRIVATE_REPLY_NOT_SENT: '私訊沒有送出時不公開回覆',
  CAPABILITY_DISABLED: '平台尚未開放公開回覆',
  RATE_LIMITED: 'Meta 暫時限制發送次數',
  PERMISSION_MISSING: '粉專缺少管理貼文互動的授權',
  UNKNOWN_AFTER_CRASH: '系統中斷，無法確認是否已公開回覆',
  UNKNOWN: '公開回覆失敗',
};

/** 規則列表的警示代碼（planning/02-architecture.md：RuleView.warnings） */
export const RULE_WARNING_LABELS: Record<string, string> = {
  CHANNEL_NOT_SUBSCRIBED: '這個帳號尚未開啟留言接收，留言不會觸發',
  MATERIAL_INACTIVE: '素材已停用，不會送出',
  PUBLIC_REPLY_PERMISSION_MISSING: '缺少公開回覆所需的授權，不會公開回覆',
  OVER_PLAN_LIMIT: '啟用中的規則已超過方案上限：既有規則照常生效，但不能再啟用其他規則',
  FEATURE_DISABLED: '目前的方案未包含留言自動私訊，規則不會執行',
};

export function ruleWarningLabel(code: string): string {
  return RULE_WARNING_LABELS[code] ?? '這條規則有設定問題，請檢查';
}

/** 留言自動私訊只支援 FB 粉專與 IG 專業帳號（IG 的渠道類型是 THREADS） */
export function platformOf(channelType: string): 'fb' | 'ig' | null {
  const t = channelType.toUpperCase();
  if (t === 'FB') return 'fb';
  if (t === 'THREADS' || t === 'INSTAGRAM' || t === 'IG') return 'ig';
  return null;
}

export function platformLabel(channelType: string): string {
  return platformOf(channelType) === 'ig' ? 'Instagram' : 'Facebook';
}
