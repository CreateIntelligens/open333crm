/**
 * 留言關鍵字自動私訊的模組內型別與常數（change add-comment-keyword-private-reply）。
 *
 * 狀態、原因、警示代碼與中文標籤的單一來源在 `@open333crm/shared` 的 comment-reply.ts（design D8），這裡只轉出型別。
 * 資料表型別在 schema 與 migration 合併前，先以本地 interface 描述 design「資料模型」的欄位；
 * Prisma 產生型別後，service 直接用 Prisma 型別，這裡的 interface 只留給純函式使用。
 */
import type {
  CommentPublicReplyReasonCode,
  CommentPublicReplyStatus,
  CommentReplyReasonCode,
  CommentReplyStatus,
  CommentReplyWarningCode,
} from '@open333crm/shared';

export type {
  CommentPublicReplyReasonCode,
  CommentPublicReplyStatus,
  CommentReplyReasonCode,
  CommentReplyStatus,
  CommentReplyWarningCode,
};

/** API 行程消費的佇列（design D1） */
export const COMMENT_REPLY_QUEUE = 'comment-reply';
/** 佇列 job 名稱（design D1） */
export const COMMENT_REPLY_JOB_DELIVER = 'deliver';

export type CommentReplyMatchMode = 'any' | 'all';
export type CommentReplyPostScope = 'all' | 'selected';
export type CommentReplyContentType = 'material' | 'text';

/** 規則存檔的貼文快照，只做顯示（design 資料模型 `postSnapshots`） */
export interface CommentReplyPostSnapshot {
  postId: string;
  permalink?: string;
  thumbnailUrl?: string;
  excerpt?: string;
  publishedAt?: Date;
}

/**
 * 對應 design「資料模型」的 `CommentReplyRule`（comment_reply_rules）。
 * TODO: schema 合併後改用 Prisma 產生的 CommentReplyRule 型別。
 */
export interface CommentReplyRuleRecord {
  id: string;
  tenantId: string;
  channelId: string;
  name: string;
  keywords: string[];
  matchMode: CommentReplyMatchMode;
  postScope: CommentReplyPostScope;
  postIds: string[];
  postSnapshots: CommentReplyPostSnapshot[];
  contentType: CommentReplyContentType;
  materialId: string | null;
  messageText: string | null;
  dedupePerCommenter: boolean;
  publicReplyEnabled: boolean;
  publicReplyTexts: string[];
  isActive: boolean;
  priority: number;
  createdById: string | null;
  updatedById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 留言時間的來源：FB 用留言的 created_time，IG 用通知時間 entry.time（design D14） */
export type CommentCreatedAtSource = 'comment' | 'notification';
