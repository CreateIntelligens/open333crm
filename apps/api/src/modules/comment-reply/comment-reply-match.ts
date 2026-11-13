/**
 * 留言規則比對（change add-comment-keyword-private-reply design D4；comment-reply-rules「關鍵字比對方式」
 * 「規則的優先順序」）。
 *
 * 純函式：收件 flow 與試算（POST /rules/test）呼叫同一支，對同一組（渠道、貼文、文字）得到相同結果。
 * 關鍵字比對沿用 `@open333crm/automation` 的 matchKeywords()，留言用 NFKC＋小寫（`＋１` 等於 `+1`）。
 * 貼文 ID 已由外掛正規化（FB `{pageId}_{postId}`、IG media id），這裡只做相等比較。
 */
import { matchKeywords, normalizeKeywordText } from '@open333crm/automation';
import type { CommentReplyMatchMode, CommentReplyPostScope } from './comment-reply.types.js';

/** 比對需要的規則欄位（design 資料模型 CommentReplyRule 的子集） */
export interface MatchableCommentRule {
  id: string;
  channelId: string;
  keywords: string[];
  matchMode: CommentReplyMatchMode;
  postScope: CommentReplyPostScope;
  postIds: string[];
  priority: number;
  isActive: boolean;
  deletedAt: Date | null;
}

export interface CommentMatchEvent {
  channelId: string;
  postId: string;
  /** 貼圖留言沒有文字 */
  text: string | null | undefined;
}

export interface CommentRuleMatch<R> {
  rule: R;
  matchedKeywords: string[];
}

/** 留言比對的正規化（NFKC＋小寫）；規則存檔時檢查關鍵字重複也用它 */
export function normalizeForCommentMatch(text: string): string {
  return normalizeKeywordText(text, 'nfkc');
}

/**
 * 依 priority 升冪（同 priority 保持輸入順序），回傳第一條命中的啟用規則；都沒命中回傳 null。
 * 停用、已刪除、別的渠道、非指定貼文的規則跳過，不會擋住後面的規則。
 */
export function matchCommentRule<R extends MatchableCommentRule>(
  rules: readonly R[],
  event: CommentMatchEvent,
): CommentRuleMatch<R> | null {
  if (!event.text) return null;
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index);

  for (const { rule } of ordered) {
    if (!rule.isActive || rule.deletedAt) continue;
    if (rule.channelId !== event.channelId) continue;
    if (rule.postScope === 'selected' && !rule.postIds.includes(event.postId)) continue;
    const hit = matchKeywords(rule.keywords, rule.matchMode, event.text, { normalize: 'nfkc' });
    if (hit) return { rule, matchedKeywords: hit.matchedKeywords };
  }
  return null;
}
