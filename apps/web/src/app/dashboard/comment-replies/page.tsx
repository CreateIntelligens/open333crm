'use client';

/**
 * 留言自動私訊（change add-comment-keyword-private-reply；planning/01-ux.md §2～§6）。
 *
 * 顧客在 Facebook、Instagram 貼文留言出現關鍵字時，自動私訊他一則訊息。
 * 兩個分頁：規則（預設）、觸發紀錄（?tab=logs）。
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Info, Plus } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermission } from '@/providers/AuthProvider';
import { getApiErrorMessage } from '@/lib/api-error';
import { platformLabel, platformOf } from '@/lib/comment-reply/codes';
import {
  fetchCommentReplyLogSummary,
  useCommentReplyReadiness,
  useCommentReplyRules,
} from '@/hooks/useCommentReplies';
import {
  CommentReplyNoChannelState,
  CommentReplyReadinessCard,
  CommentReplyUnavailable,
} from '@/components/comment-replies/CommentReplyReadinessCard';
import { CommentReplyRuleList } from '@/components/comment-replies/CommentReplyRuleList';
import { CommentReplyTestPanel } from '@/components/comment-replies/CommentReplyTestPanel';
import { CommentReplyLogs } from '@/components/comment-replies/CommentReplyLogs';

function HowTo() {
  return (
    <section className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Info className="h-4 w-4 text-primary" aria-hidden="true" />
        怎麼用？
      </div>
      <ol className="ml-1 mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
        <li>先選粉專或 IG 帳號，設定關鍵字與要私訊的內容（Facebook 可用素材庫的素材，Instagram 目前只能用文字）。</li>
        <li>顧客在貼文留言出現關鍵字，系統私訊他一次；有設定時，也會用粉專身分公開回覆這則留言。</li>
        <li>私訊送出後不會立刻出現在收件匣，顧客回覆後對話才會進收件匣，並標示「來自留言」。私訊送出、失敗或過期，都記在「觸發紀錄」。</li>
      </ol>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 text-left font-medium">顧客做了什麼</th>
              <th className="py-1 pr-4 text-left font-medium">用哪個功能</th>
              <th className="py-1 text-left font-medium">系統怎麼回</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1 pr-4">在貼文底下留言，出現關鍵字</td>
              <td className="py-1 pr-4">留言自動私訊（本頁）</td>
              <td className="py-1">私訊留言者一則訊息，可另外公開回覆留言</td>
            </tr>
            <tr>
              <td className="py-1 pr-4">在 LINE、Messenger、IG 私訊中傳關鍵字</td>
              <td className="py-1 pr-4"><Link href="/dashboard/line/keyword-replies" className="text-primary underline">關鍵字回覆</Link></td>
              <td className="py-1">在對話中回覆素材或發券，每次都會回</td>
            </tr>
            <tr>
              <td className="py-1 pr-4">其他事件（加好友、建立工單、貼標籤……）</td>
              <td className="py-1 pr-4"><Link href="/dashboard/automation" className="text-primary underline">自動化</Link></td>
              <td className="py-1">依規則執行多種動作</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded border border-warning/30 bg-warning-subtle px-3 py-1.5 text-xs text-warning">
        每則留言只能私訊一次，且限留言後 7 天內。只有新留言會觸發，編輯過的留言與直播留言不會；規則建立或帳號開啟留言接收之前的留言不會補送。
        沒有和粉專聊過天的顧客，可能會在「訊息請求」裡看到私訊，建議在公開回覆中提醒顧客查看。
        想讓顧客領券，請在私訊中請顧客「回覆關鍵字領券」，再用關鍵字回覆發券。
      </div>
    </section>
  );
}

function CommentRepliesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canView = usePermission('comment_reply.view');
  const canManage = usePermission('comment_reply.manage');

  const tab = searchParams?.get('tab') === 'logs' ? 'logs' : 'rules';
  const { readiness, error: readinessError, isLoading: readinessLoading, mutate: mutateReadiness } = useCommentReplyReadiness(canView);
  const { rules, isLoading: rulesLoading, error: rulesError, mutate: mutateRules } = useCommentReplyRules(canView);
  const [channelFilter, setChannelFilter] = useState('');
  const [failed24h, setFailed24h] = useState(0);

  // 分頁標籤的「N 筆失敗」：近 24 小時，不受紀錄頁篩選影響
  useEffect(() => {
    if (!canView) return;
    fetchCommentReplyLogSummary({ statuses: [] })
      .then((s) => setFailed24h(s.failed24h))
      .catch(() => setFailed24h(0));
  }, [canView]);

  const switchTab = useCallback(
    (value: string) => {
      router.replace(value === 'logs' ? `${pathname}?tab=logs` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  if (!canView) return <CommentReplyUnavailable />;
  if (readinessLoading) return <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>;
  if (readinessError || !readiness) {
    return (
      <div role="alert" className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">
        {getApiErrorMessage(readinessError, '留言自動私訊的設定載入失敗，請重新整理')}
      </div>
    );
  }

  const channels = readiness.channels.filter((c) => platformOf(c.channelType));
  const testChannels = channels.map((c) => ({ channelId: c.channelId, channelType: c.channelType, displayName: c.displayName }));
  const canCreate = canManage && !readiness.emergencyStopped && channels.length > 0;
  const quota = readiness.quota;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">留言自動私訊</h1>
          <p className="mt-1 text-sm text-muted-foreground">顧客在 Facebook、Instagram 貼文留言出現關鍵字時，自動私訊他一則訊息。</p>
          {quota && (quota.monthlyLimit != null || quota.maxRules != null) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {quota.monthlyLimit != null && `本月已私訊 ${quota.monthlyUsed.toLocaleString('en-US')}／${quota.monthlyLimit.toLocaleString('en-US')} 則`}
              {quota.monthlyLimit != null && quota.maxRules != null && '　'}
              {quota.maxRules != null && `啟用中的規則 ${quota.activeRules}／${quota.maxRules} 條`}
            </p>
          )}
        </div>
        {canCreate && (
          <Link
            href={channelFilter ? `/dashboard/comment-replies/new?channelId=${channelFilter}` : '/dashboard/comment-replies/new'}
            className={buttonVariants()}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            建立規則
          </Link>
        )}
      </header>

      <HowTo />

      {channels.length === 0 ? (
        <CommentReplyNoChannelState />
      ) : (
        <>
          <CommentReplyReadinessCard readiness={readiness} onChanged={() => mutateReadiness()} />

          <Tabs value={tab} onValueChange={switchTab} variant="underline">
            <TabsList aria-label="留言自動私訊">
              <TabsTrigger value="rules">規則</TabsTrigger>
              <TabsTrigger value="logs">
                觸發紀錄
                {failed24h > 0 && <span className="text-destructive">{`（${failed24h} 筆失敗）`}</span>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="rules" className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="依渠道篩選">
                {[{ channelId: '', label: '全部' }, ...channels.map((c) => ({ channelId: c.channelId, label: `${platformLabel(c.channelType)} · ${c.displayName}` }))].map((c) => (
                  <button
                    key={c.channelId || 'all'}
                    type="button"
                    aria-pressed={channelFilter === c.channelId}
                    onClick={() => setChannelFilter(c.channelId)}
                    className={
                      channelFilter === c.channelId
                        ? 'rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                        : 'rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground hover:text-foreground'
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <CommentReplyTestPanel channels={testChannels} defaultChannelId={channelFilter || undefined} />
              {rulesLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>
              ) : rulesError ? (
                <div role="alert" className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">
                  {getApiErrorMessage(rulesError, '規則載入失敗，請重新整理')}
                </div>
              ) : (
                <CommentReplyRuleList
                  rules={rules}
                  canManage={canManage && !readiness.emergencyStopped}
                  channelFilter={channelFilter || undefined}
                  onChanged={async () => {
                    await Promise.all([mutateRules(), mutateReadiness()]);
                  }}
                />
              )}
            </TabsContent>
            <TabsContent value="logs">
              <CommentReplyLogs
                channels={testChannels}
                rules={rules}
                canManage={canManage && !readiness.emergencyStopped}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

export default function CommentRepliesPage() {
  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="渠道" />
      <main className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>}>
          <CommentRepliesContent />
        </Suspense>
      </main>
    </div>
  );
}
