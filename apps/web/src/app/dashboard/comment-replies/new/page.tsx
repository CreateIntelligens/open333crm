'use client';

/**
 * 建立留言自動私訊規則（planning/01-ux.md §3.2、§3.3）。可帶 ?channelId= 預選渠道。
 */
import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Topbar } from '@/components/layout/Topbar';
import { usePermission } from '@/providers/AuthProvider';
import { getApiErrorMessage } from '@/lib/api-error';
import { platformOf } from '@/lib/comment-reply/codes';
import { useCommentReplyReadiness, useCommentReplyRules } from '@/hooks/useCommentReplies';
import { CommentReplyRuleEditor } from '@/components/comment-replies/CommentReplyRuleEditor';
import { CommentReplyNoChannelState, CommentReplyUnavailable } from '@/components/comment-replies/CommentReplyReadinessCard';

function NewRuleContent() {
  const searchParams = useSearchParams();
  const canView = usePermission('comment_reply.view');
  const canManage = usePermission('comment_reply.manage');
  const { readiness, error, isLoading } = useCommentReplyReadiness(canView);
  const { rules } = useCommentReplyRules(canView);

  if (!canView) return <CommentReplyUnavailable />;
  if (!canManage) {
    return (
      <div className="rounded-lg border border-dashed border-input bg-white px-6 py-16 text-center text-sm text-muted-foreground">
        你只有檢視權限，無法建立規則。
        <Link href="/dashboard/comment-replies" className="ml-1 text-primary underline">返回留言自動私訊</Link>
      </div>
    );
  }
  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>;
  if (error || !readiness) {
    return <div role="alert" className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{getApiErrorMessage(error, '設定載入失敗，請重新整理')}</div>;
  }
  if (!readiness.channels.some((c) => platformOf(c.channelType))) return <CommentReplyNoChannelState />;

  return (
    <CommentReplyRuleEditor
      readiness={readiness}
      defaultChannelId={searchParams?.get('channelId') ?? undefined}
      existingRules={rules}
    />
  );
}

export default function NewCommentReplyRulePage() {
  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="渠道" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>}>
            <NewRuleContent />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
