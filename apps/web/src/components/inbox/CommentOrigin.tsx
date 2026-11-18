'use client';

/**
 * 收件匣「來自留言」的標籤與系統訊息（change add-comment-keyword-private-reply；
 * spec comment-reply-contact-linking「收件匣標示來自留言的對話」；design D18、Open Questions 6）。
 */
import React from 'react';
import Link from 'next/link';
import { usePermission } from '@/providers/AuthProvider';

/** 對話列表 API 回傳的來源（origin.type 由 spec 規定；logId、at 依 planning/02-architecture.md §6.5） */
export interface ConversationOrigin {
  type: string;
  logId?: string | null;
  /** 來源建立時間；缺少時視為仍在顯示期間內 */
  at?: string | null;
  sentAt?: string | null;
}

export const COMMENT_ORIGIN_TYPE = 'comment_private_reply';
/** 對話列表的標籤只顯示 7 天（design Open Questions 6 的預設值）；對話內的系統訊息永久保留 */
export const COMMENT_ORIGIN_BADGE_DAYS = 7;

export function isCommentOriginBadgeVisible(origin: ConversationOrigin | null | undefined, now = Date.now()): boolean {
  if (!origin || origin.type !== COMMENT_ORIGIN_TYPE) return false;
  const at = origin.at ?? origin.sentAt;
  if (!at) return true;
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t <= COMMENT_ORIGIN_BADGE_DAYS * 24 * 60 * 60 * 1000;
}

export function CommentOriginBadge({ origin }: { origin?: ConversationOrigin | null }) {
  if (!isCommentOriginBadgeVisible(origin)) return null;
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
      title="這個對話來自貼文留言的自動私訊"
    >
      來自留言
    </span>
  );
}

/** 訊息是否為留言自動私訊補入的訊息（系統說明或私訊快照） */
export function commentReplyMessageKind(metadata: Record<string, unknown> | undefined): 'origin_note' | 'snapshot' | null {
  if (!metadata || metadata.source !== COMMENT_ORIGIN_TYPE) return null;
  return metadata.kind === 'origin_note' ? 'origin_note' : 'snapshot';
}

/** 對話開頭的系統訊息；「查看留言紀錄」只對有 comment_reply.view 的成員顯示 */
export function CommentOriginNote({ text, logId }: { text: string; logId?: string | null }) {
  const canView = usePermission('comment_reply.view');
  return (
    <div className="flex justify-center py-2">
      <span className="max-w-[90%] rounded-lg bg-muted px-3 py-1 text-xs text-muted-foreground">
        {text}
        {canView && logId && (
          <>
            {' '}
            <Link href={`/dashboard/comment-replies?tab=logs&logId=${encodeURIComponent(logId)}`} className="font-medium text-primary underline">
              查看留言紀錄
            </Link>
          </>
        )}
      </span>
    </div>
  );
}
