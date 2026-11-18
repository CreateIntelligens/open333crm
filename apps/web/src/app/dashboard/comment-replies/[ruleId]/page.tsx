'use client';

/**
 * 留言自動私訊規則：編輯或檢視（planning/01-ux.md §3.2、§8）。
 * 看不到的規則（其他租戶、不在可見範圍）後端回 404，畫面只說「找不到這條規則」。
 */
import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Topbar } from '@/components/layout/Topbar';
import { usePermission } from '@/providers/AuthProvider';
import { getApiErrorMessage } from '@/lib/api-error';
import { useCommentReplyReadiness, useCommentReplyRule, useCommentReplyRules } from '@/hooks/useCommentReplies';
import { CommentReplyRuleEditor } from '@/components/comment-replies/CommentReplyRuleEditor';
import { CommentReplyUnavailable } from '@/components/comment-replies/CommentReplyReadinessCard';

function isNotFound(err: unknown): boolean {
  return (err as { response?: { status?: number } } | undefined)?.response?.status === 404;
}

export default function CommentReplyRulePage() {
  const params = useParams<{ ruleId: string }>();
  const ruleId = typeof params?.ruleId === 'string' ? params.ruleId : null;
  const canView = usePermission('comment_reply.view');
  const { readiness, error: readinessError, isLoading: readinessLoading } = useCommentReplyReadiness(canView);
  const { rule, error: ruleError, isLoading: ruleLoading } = useCommentReplyRule(canView ? ruleId : null);
  const { rules } = useCommentReplyRules(canView);

  let body: React.ReactNode;
  if (!canView) body = <CommentReplyUnavailable />;
  else if (readinessLoading || ruleLoading) body = <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>;
  else if (ruleError && isNotFound(ruleError)) {
    body = (
      <div className="rounded-lg border border-dashed border-input bg-white px-6 py-16 text-center text-sm text-muted-foreground">
        找不到這條規則
        <Link href="/dashboard/comment-replies" className="ml-1 text-primary underline">返回留言自動私訊</Link>
      </div>
    );
  } else if (ruleError || readinessError || !rule || !readiness) {
    body = (
      <div role="alert" className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">
        {getApiErrorMessage(ruleError ?? readinessError, '規則載入失敗，請重新整理')}
      </div>
    );
  } else {
    body = <CommentReplyRuleEditor key={rule.id} readiness={readiness} rule={rule} existingRules={rules} />;
  }

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="渠道" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">{body}</div>
      </main>
    </div>
  );
}
