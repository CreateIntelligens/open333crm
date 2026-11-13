/**
 * 留言關鍵字自動私訊：狀態、原因、警示代碼與中文標籤的單一來源
 * （change add-comment-keyword-private-reply design D8）。
 *
 * 後端把 reasonCode 存成 TEXT，前端用這裡的對照表顯示；未知代碼顯示通用失敗文字，
 * 避免前後端各寫一份而漂移。文字以 planning/01-ux.md §4.2、§4.3 為準。
 */

// ─── 私訊狀態 ────────────────────────────────────────────────────────────

/** 對應資料庫 enum CommentReplyStatus */
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

/** SENDING 是內部狀態（送出中），畫面與 PENDING 同樣顯示「處理中」 */
export const COMMENT_REPLY_STATUS_LABELS: Record<CommentReplyStatus, string> = {
  PENDING: '處理中',
  SENDING: '處理中',
  SENT: '已送出',
  FAILED: '失敗',
  EXPIRED: '已過期',
  SKIPPED: '略過',
  SKIPPED_DUPLICATE: '已私訊過',
};

// ─── 私訊原因代碼（依狀態分組） ──────────────────────────────────────────

export const COMMENT_REPLY_REASONS_BY_STATUS = {
  PENDING: ['RATE_LIMIT_QUEUED'],
  SENDING: [],
  SENT: ['SENT_UNCONFIRMED'],
  SKIPPED: [
    'RULE_INACTIVE',
    'MATERIAL_UNAVAILABLE',
    'MATERIAL_UNSUPPORTED',
    'PLAN_FEATURE_DISABLED',
    'CAPABILITY_DISABLED',
    'EMERGENCY_STOPPED',
    'PLAN_QUOTA_EXCEEDED',
    'CHANNEL_INACTIVE',
    'TENANT_DISABLED',
  ],
  EXPIRED: ['WINDOW_EXPIRED', 'EXPIRED_BY_META'],
  FAILED: [
    'TOKEN_EXPIRED',
    'PERMISSION_MISSING',
    'APP_NOT_APPROVED',
    'USER_UNAVAILABLE',
    'COMMENT_NOT_FOUND',
    'ALREADY_REPLIED',
    'RECIPIENT_IS_PAGE',
    'RATE_LIMITED',
    'NETWORK',
    'UNKNOWN',
  ],
  SKIPPED_DUPLICATE: [],
} as const satisfies Record<CommentReplyStatus, readonly string[]>;

export type CommentReplySkipReason = (typeof COMMENT_REPLY_REASONS_BY_STATUS.SKIPPED)[number];
export type CommentReplyExpiredReason = (typeof COMMENT_REPLY_REASONS_BY_STATUS.EXPIRED)[number];
export type CommentReplyFailureReason = (typeof COMMENT_REPLY_REASONS_BY_STATUS.FAILED)[number];
export type CommentReplyReasonCode =
  (typeof COMMENT_REPLY_REASONS_BY_STATUS)[keyof typeof COMMENT_REPLY_REASONS_BY_STATUS][number];

export const COMMENT_REPLY_REASON_CODES: readonly CommentReplyReasonCode[] = Object.values(
  COMMENT_REPLY_REASONS_BY_STATUS,
).flat() as CommentReplyReasonCode[];

export const COMMENT_REPLY_REASON_LABELS: Record<CommentReplyReasonCode, string> = {
  RATE_LIMIT_QUEUED: '排隊中',
  SENT_UNCONFIRMED: '可能已送達',
  RULE_INACTIVE: '規則已停用或刪除',
  MATERIAL_UNAVAILABLE: '素材已刪除或停用',
  MATERIAL_UNSUPPORTED: '這個素材的類型不能用於留言私訊',
  PLAN_FEATURE_DISABLED: '目前方案未包含留言自動私訊',
  CAPABILITY_DISABLED: '平台尚未開放這項功能',
  EMERGENCY_STOPPED: '平台暫停中',
  PLAN_QUOTA_EXCEEDED: '本月私訊數已達方案上限',
  CHANNEL_INACTIVE: '渠道已停用',
  TENANT_DISABLED: '帳號已停用',
  WINDOW_EXPIRED: '留言已超過 7 天，Meta 不允許私訊',
  EXPIRED_BY_META: 'Meta 回覆已超過可私訊的期限',
  TOKEN_EXPIRED: '粉專連結已失效',
  PERMISSION_MISSING: '粉專授權不足，無法私訊',
  APP_NOT_APPROVED: '這位顧客不在 App 的測試名單內（App 審核通過前只有測試帳號能收到）',
  USER_UNAVAILABLE: '顧客無法接收訊息（可能已封鎖粉專或關閉訊息功能）',
  COMMENT_NOT_FOUND: '留言已被刪除或隱藏，無法私訊',
  ALREADY_REPLIED: '這則留言已經私訊過（可能是在 Meta Business Suite 手動私訊的）',
  RECIPIENT_IS_PAGE: '留言者是粉專，無法私訊',
  RATE_LIMITED: 'Meta 暫時限制發送次數，系統已重試仍未成功',
  NETWORK: '連線 Meta 失敗，系統已重試仍未成功',
  UNKNOWN: '送出失敗',
};

/** 未知代碼（例如後端新增、前端還沒更新）顯示的通用文字 */
export const COMMENT_REPLY_UNKNOWN_REASON_LABEL = '處理失敗（原因不明）';

/** 原因代碼的中文；null 表示沒有原因 */
export function commentReplyReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return (COMMENT_REPLY_REASON_LABELS as Record<string, string>)[code] ?? COMMENT_REPLY_UNKNOWN_REASON_LABEL;
}

/**
 * 後台可手動重試的原因（重新連結、等限流解除或下個月後可能成功）。
 * 不在清單內的 FAILED 原因（顧客端或 Meta 已確定拒絕）重試也不會成功。
 */
export const COMMENT_REPLY_RETRYABLE_FAILURE_REASONS: readonly CommentReplyFailureReason[] = [
  'TOKEN_EXPIRED',
  'PERMISSION_MISSING',
  'RATE_LIMITED',
  'NETWORK',
  'UNKNOWN',
];

/**
 * 狀態與原因是否可手動重試（不含 7 天期限的判斷，期限由 API 以注入的 now 檢查）。
 * 可重試：上列原因的 FAILED，或原因 PLAN_QUOTA_EXCEEDED 的 SKIPPED。
 */
export function isCommentReplyRetryable(status: string, reasonCode: string | null | undefined): boolean {
  if (status === 'FAILED') {
    return (COMMENT_REPLY_RETRYABLE_FAILURE_REASONS as readonly string[]).includes(reasonCode ?? '');
  }
  return status === 'SKIPPED' && reasonCode === 'PLAN_QUOTA_EXCEEDED';
}

// ─── 公開回覆子狀態 ──────────────────────────────────────────────────────

export const COMMENT_PUBLIC_REPLY_STATUSES = ['NOT_CONFIGURED', 'PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type CommentPublicReplyStatus = (typeof COMMENT_PUBLIC_REPLY_STATUSES)[number];

export const COMMENT_PUBLIC_REPLY_STATUS_LABELS: Record<CommentPublicReplyStatus, string> = {
  NOT_CONFIGURED: '未設定',
  PENDING: '處理中',
  SENDING: '處理中',
  SENT: '已公開回覆',
  FAILED: '失敗',
  SKIPPED: '略過',
};

export const COMMENT_PUBLIC_REPLY_REASON_CODES = [
  'PRIVATE_REPLY_NOT_SENT',
  'CAPABILITY_DISABLED',
  'RATE_LIMITED',
  'PERMISSION_MISSING',
  'UNKNOWN_AFTER_CRASH',
  'UNKNOWN',
] as const;
export type CommentPublicReplyReasonCode = (typeof COMMENT_PUBLIC_REPLY_REASON_CODES)[number];

export const COMMENT_PUBLIC_REPLY_REASON_LABELS: Record<CommentPublicReplyReasonCode, string> = {
  PRIVATE_REPLY_NOT_SENT: '私訊沒有送出，因此沒有公開回覆',
  CAPABILITY_DISABLED: '平台尚未開放公開回覆',
  RATE_LIMITED: '公開回覆已達本小時上限',
  PERMISSION_MISSING: '缺少管理貼文互動的權限',
  UNKNOWN_AFTER_CRASH: '送出途中中斷，無法確認是否已回覆',
  UNKNOWN: '公開回覆失敗',
};

// ─── 規則列表警示 ────────────────────────────────────────────────────────

/** RuleView.warnings 的代碼（規則仍可儲存，但列表持續提示） */
export const COMMENT_REPLY_WARNING_CODES = [
  'OVER_PLAN_LIMIT',
  'CHANNEL_NOT_SUBSCRIBED',
  'MATERIAL_INACTIVE',
  'PUBLIC_REPLY_PERMISSION_MISSING',
  'FEATURE_DISABLED',
] as const;
export type CommentReplyWarningCode = (typeof COMMENT_REPLY_WARNING_CODES)[number];

export const COMMENT_REPLY_WARNING_LABELS: Record<CommentReplyWarningCode, string> = {
  OVER_PLAN_LIMIT: '啟用中的規則數超過目前方案上限',
  CHANNEL_NOT_SUBSCRIBED: '這個粉專尚未開啟留言接收',
  MATERIAL_INACTIVE: '素材已停用，不會送出',
  PUBLIC_REPLY_PERMISSION_MISSING: '缺少管理貼文互動的權限，無法公開回覆',
  FEATURE_DISABLED: '目前方案未包含留言自動私訊',
};
