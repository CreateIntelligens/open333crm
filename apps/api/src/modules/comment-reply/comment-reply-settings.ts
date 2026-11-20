/**
 * 渠道的 settings.commentReply（change add-comment-keyword-private-reply design D19）：解析與寫入只有這一份。
 *
 * 形狀：{ receiving, subscribedAt, subscription: { status, fields, checkedAt }, lastCommentEventAt }
 * - receiving：是否開啟留言接收
 * - subscribedAt：第一次訂閱留言欄位成功的時間。之後重新連結、重新開啟都不覆寫
 * - subscription：最後一次訂閱或檢查的結果。checkedAt 是最後一次的時間
 * - lastCommentEventAt：最後收到留言事件的時間（comment-reply-health 排程寫入）
 *
 * 呼叫端：後台開關留言接收（comment-reply-channel.service）、連結粉專（meta-connect.service）、
 * 補訂閱腳本（scripts/comment-reply-subscriptions.ts）、訂閱檢查（channel/meta-token-health）、平台健康頁。
 * 本檔不 import 其他模組，所以 meta-connect 與 channel 模組都可以 import，不會形成循環。
 */

function obj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export interface CommentReplySettings {
  receiving: boolean;
  subscribedAt: string | null;
  subscription: { status: string | null; fields: string[]; checkedAt: string | null } | null;
  lastCommentEventAt: string | null;
  /** 原始的 settings.commentReply 物件。寫入時以它為基礎，保留本檔不認得的子鍵 */
  raw: Record<string, any>;
}

/** 從渠道的 settings 解析 commentReply。沒有值或形狀不對的子鍵回預設值 */
export function commentReplySettingsOf(settings: unknown): CommentReplySettings {
  const cr = obj(obj(settings).commentReply);
  const sub = cr.subscription ? obj(cr.subscription) : null;
  return {
    receiving: cr.receiving === true,
    subscribedAt: str(cr.subscribedAt),
    subscription: sub
      ? {
          status: str(sub.status),
          fields: Array.isArray(sub.fields) ? sub.fields.map(String) : [],
          checkedAt: str(sub.checkedAt),
        }
      : null,
    lastCommentEventAt: str(cr.lastCommentEventAt),
    raw: cr,
  };
}

/**
 * 訂閱或取消訂閱留言欄位成功之後，新的 settings.commentReply。保留其他子鍵（例如 lastCommentEventAt）。
 * subscribedAt 只在第一次開啟時寫入。
 *
 * @param settings 渠道目前的 settings
 * @param receiving 是否開啟留言接收
 * @param fields 送給 Meta 的完整訂閱欄位
 * @param now 這次訂閱的時間
 * @returns 用來取代 settings.commentReply 的物件
 */
export function nextCommentReplySettings(settings: unknown, receiving: boolean, fields: string[], now: Date = new Date()): Record<string, unknown> {
  const current = commentReplySettingsOf(settings);
  const at = now.toISOString();
  return {
    ...current.raw,
    receiving,
    ...(receiving && !current.subscribedAt ? { subscribedAt: at } : {}),
    subscription: { status: receiving ? 'ok' : 'disabled', fields, checkedAt: at },
  };
}
