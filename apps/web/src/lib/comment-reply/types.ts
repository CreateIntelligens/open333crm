/**
 * 留言自動私訊（change add-comment-keyword-private-reply）前端使用的 API 型別。
 * 欄位以 design.md「API」一節與 planning/01-ux.md §11 為準，後端是權威來源。
 */
import type { CommentReplyStatus } from './codes';

export type CommentReplyChannelType = 'FB' | 'THREADS';

export interface CommentReplyPost {
  postId: string;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  excerpt?: string | null;
  publishedAt?: string | null;
  mediaType?: string | null;
  /** 貼文已刪除或讀不到 */
  unavailable?: boolean;
}

export type CommentReplyContent =
  | { type: 'text'; text: string; materialId?: null; materialName?: null; materialStatus?: null }
  | { type: 'material'; materialId: string | null; materialName?: string | null; materialStatus?: string | null; text?: null };

export interface CommentReplyRuleView {
  id: string;
  name: string;
  channelId: string;
  channel: { id: string; channelType: string; displayName: string; accountId?: string | null };
  keywords: string[];
  matchMode: 'any' | 'all';
  postScope: 'all' | 'selected';
  posts: CommentReplyPost[];
  content: CommentReplyContent;
  dedupePerCommenter: boolean;
  publicReply: { enabled: boolean; texts: string[] };
  isActive: boolean;
  priority: number;
  /** 後端依 manage 權限＋渠道存取層級算出，前端不自行推算 */
  canEdit: boolean;
  stats7d: { sent: number; failed: number; expired: number; duplicate: number };
  warnings: string[];
}

/** POST /rules 的內容（design「RuleInput」） */
export interface CommentReplyRuleInput {
  channelId: string;
  name: string;
  keywords: string[];
  matchMode: 'any' | 'all';
  postScope: 'all' | 'selected';
  posts: CommentReplyPost[];
  content: { type: 'text'; text: string } | { type: 'material'; materialId: string };
  dedupePerCommenter: boolean;
  publicReply: { enabled: boolean; texts: string[] };
  isActive: boolean;
}

/** PATCH /rules/:id 不可帶 channelId（design：帶了回 400 CHANNEL_IMMUTABLE） */
export type CommentReplyRulePatch = Omit<CommentReplyRuleInput, 'channelId'>;

export interface CommentReplyCapabilities {
  fbPrivateReply: boolean;
  fbPostPicker: boolean;
  fbPublicReply: boolean;
  igPrivateReply: boolean;
  igPostPicker: boolean;
  igPublicReply: boolean;
}

export interface CommentReplyReadinessChannel {
  channelId: string;
  channelType: string;
  displayName: string;
  appMode: 'platform' | 'own_app' | string;
  receiving: boolean;
  /** 查 Meta 逾時或不明時是 null */
  subscribed: boolean | null;
  /** null＝無法得知（IG Instagram Login 沒有 debug_token） */
  missingPermissions: string[] | null;
  canPrivateReply: boolean;
  canPublicReply: boolean;
  tokenStatus?: string | null;
  lastCommentEventAt?: string | null;
}

export interface CommentReplyReadiness {
  testPhase: { fb: boolean; ig: boolean };
  capabilities: CommentReplyCapabilities;
  emergencyStopped: boolean;
  quota: { monthlyUsed: number; monthlyLimit: number | null; activeRules: number; maxRules: number | null };
  channels: CommentReplyReadinessChannel[];
}

export interface CommentReplyLogItem {
  id: string;
  status: CommentReplyStatus | string;
  reasonCode?: string | null;
  reasonMessage?: string | null;
  commentId: string;
  commentText?: string | null;
  commentCreatedAt: string;
  isReplyToComment?: boolean;
  commenterName?: string | null;
  commenterUsername?: string | null;
  post?: { postId: string; permalink?: string | null; thumbnailUrl?: string | null; excerpt?: string | null } | null;
  rule?: { id: string; name: string; deleted?: boolean } | null;
  channel?: { id: string; channelType: string; displayName: string } | null;
  processedAt?: string | null;
  receivedAt?: string | null;
  matchedKeywords?: string[];
  conversationId?: string | null;
  customerReplied?: boolean;
  customerRepliedAt?: string | null;
  sentAt?: string | null;
  publicReplyStatus?: string | null;
  retryable?: boolean;
  holderLogId?: string | null;
}

export interface CommentReplyLogDetail extends CommentReplyLogItem {
  sentContentSnapshot?: unknown;
  publicReplyText?: string | null;
  publicReplyReasonCode?: string | null;
  metaErrorCode?: number | null;
  metaErrorSubcode?: number | null;
  commentPermalink?: string | null;
}

export interface CommentReplyMaterialOption {
  id: string;
  name: string;
  contentType: string;
  preview?: string | null;
}

export interface CommentReplyTestResult {
  matched: boolean;
  ruleId?: string;
  ruleName?: string;
  matchedKeywords?: string[];
}
