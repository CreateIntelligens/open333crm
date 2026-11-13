/**
 * Private Replies 的 7 天期限（change add-comment-keyword-private-reply design D14）。
 *
 * 留言時間距今達「7 天減 10 分鐘」就視為過期，不呼叫 Meta（EXPIRED／WINDOW_EXPIRED）：
 * 避免排隊或時鐘誤差剛好跨過期限。消費者送出前、後台重試、補回排程都用這個判斷；now 由呼叫端注入。
 */

/** Meta 允許私訊的期限：留言後 7 天 */
export const COMMENT_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 安全邊際：提早 10 分鐘視為過期（測試以常數釘住，EX-02） */
export const COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS = 10 * 60 * 1000;

/** 留言（IG 為通知）時間距 now 已達 7 天減 10 分鐘 */
export function isCommentReplyWindowExpired(commentCreatedAt: Date, now: Date): boolean {
  return now.getTime() - commentCreatedAt.getTime() >= COMMENT_REPLY_WINDOW_MS - COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS;
}
