'use client';

/**
 * 留言自動私訊的前置條件卡與空狀態（planning/01-ux.md §5；design D22、D28）。
 *
 * - 狀態 A：沒有可用的 FB／IG 渠道 → CommentReplyNoChannelState（整頁空狀態）
 * - 狀態 B：尚未開啟留言接收（未訂閱 feed／comments）
 * - 狀態 C：權限不足（FB 重新連結、IG 重新產生權杖）
 * - 狀態 D：平台測試階段（只對平台模式渠道）
 * - 狀態 E：方案未含或角色沒有檢視權限 → CommentReplyUnavailable
 * - 平台暫停中（緊急停止）、平台尚未開放某平台的私訊能力
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Loader2, PauseCircle } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { usePermission } from '@/providers/AuthProvider';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api-error';
import { platformOf } from '@/lib/comment-reply/codes';
import type { CommentReplyReadiness, CommentReplyReadinessChannel } from '@/lib/comment-reply/types';
import { startMetaReconnect, subscribeCommentReplyChannel } from '@/hooks/useCommentReplies';

const RETURN_TO = '/dashboard/comment-replies';

function channelTitle(c: { channelType: string; displayName: string }) {
  return `${platformOf(c.channelType) === 'ig' ? 'Instagram' : 'Facebook'} · ${c.displayName}`;
}

/** 狀態 A：沒有可用的粉專或 IG 帳號（readiness.channels 為空） */
export function CommentReplyNoChannelState() {
  const viewAll = usePermission('channel.view_all');
  const canCreate = usePermission('channel.create');
  // 沒有 channel.view_all 的成員只看得到被指派的渠道：清單為空多半是沒有被開放，不要說「沒有渠道」
  if (!viewAll) {
    return (
      <div className="rounded-lg border border-dashed border-input bg-white px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">你目前沒有可使用的粉專或 IG 帳號。若需要使用，請洽管理員開放渠道權限。</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-input bg-white px-6 py-16 text-center">
      <h2 className="text-base font-semibold">還沒有可以使用的粉專或 IG 帳號</h2>
      <p className="mt-1 text-sm text-muted-foreground">留言自動私訊需要先連結 Facebook 粉專或 Instagram 專業帳號。</p>
      {canCreate ? (
        <Link href="/dashboard/settings/channels" className={buttonVariants({ className: 'mt-4' })}>
          前往渠道管理
        </Link>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">請洽管理員連結渠道</p>
      )}
    </div>
  );
}

/** 狀態 E：沒有 comment_reply.view（方案未含，或角色沒有開放） */
export function CommentReplyUnavailable() {
  return (
    <div className="rounded-lg border border-dashed border-input bg-white px-6 py-16 text-center">
      <h2 className="text-base font-semibold">無法使用留言自動私訊</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        目前的方案未包含留言自動私訊，或你的角色沒有檢視權限。請洽管理員升級方案或開放權限。
      </p>
    </div>
  );
}

/** 測試階段卡（列表頁與規則編輯頁共用） */
export function CommentReplyTestPhaseCard({ platforms }: { platforms: Array<'fb' | 'ig'> }) {
  if (platforms.length === 0) return null;
  const names = platforms.map((p) => (p === 'fb' ? 'Facebook' : 'Instagram')).join('、');
  return (
    <div className="rounded-md border border-primary-border bg-primary-subtle px-4 py-3 text-sm text-primary">
      <div className="flex items-center gap-1.5 font-semibold">
        <Info className="h-4 w-4" aria-hidden="true" />
        <span>目前為測試階段</span>
      </div>
      <p className="mt-1 text-foreground/80">
        Meta 尚未核准本系統的 {names} 留言私訊權限。核准前，只有在 Meta 開發者後台被加為測試人員的帳號留言時才會收到私訊；
        一般顧客留言會記為「失敗：不在 App 的測試名單內」。正式上線時間請洽 open333CRM 客服。
      </p>
    </div>
  );
}

/** 哪些平台要顯示測試階段卡：平台開啟測試階段，且有平台模式（非自備 App）的渠道 */
export function testPhasePlatforms(readiness: CommentReplyReadiness, channels = readiness.channels): Array<'fb' | 'ig'> {
  const out = new Set<'fb' | 'ig'>();
  for (const c of channels) {
    const p = platformOf(c.channelType);
    if (!p || c.appMode !== 'platform') continue;
    if (readiness.testPhase?.[p]) out.add(p);
  }
  return [...out];
}

/** 渠道是否尚未開啟留言接收 */
export function isNotReceiving(c: CommentReplyReadinessChannel): boolean {
  return c.receiving === false || c.subscribed === false;
}

/** 渠道缺少必要權限 */
function lacksPermission(c: CommentReplyReadinessChannel): boolean {
  return Array.isArray(c.missingPermissions) && c.missingPermissions.length > 0;
}

function ReconnectFacebookButton({ onError }: { onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await startMetaReconnect(RETURN_TO);
        } catch (err) {
          onError(getApiErrorMessage(err, '無法開始 Facebook 授權，請稍後重試'));
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
      重新連結 Facebook
    </Button>
  );
}

function NotReceivingRow({ channel, onChanged }: { channel: CommentReplyReadinessChannel; onChanged?: () => void | Promise<unknown> }) {
  const canUpdate = usePermission('channel.update');
  const canReconnect = usePermission('channel.create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const isIg = platformOf(channel.channelType) === 'ig';

  const subscribe = async () => {
    setBusy(true);
    setError('');
    try {
      await subscribeCommentReplyChannel(channel.channelId);
      await onChanged?.();
    } catch (err) {
      const code = getApiErrorCode(err);
      const reason = getApiErrorMessage(err, '請稍後重試');
      if (code === 'REAUTH_REQUIRED') setNeedsReauth(true);
      setError(
        isIg
          ? `開啟失敗：${reason}。請重新產生 Instagram 權杖後貼回渠道設定。`
          : `開啟失敗：${reason}。請改用「重新連結 Facebook」。`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1">
      <span>{channelTitle(channel)}</span>
      <span className="flex items-center gap-2">
        {canUpdate && !needsReauth && (
          <Button size="sm" variant="outline" disabled={busy} onClick={subscribe} aria-label={`開啟「${channel.displayName}」的留言接收`}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            開啟留言接收
          </Button>
        )}
        {needsReauth && !isIg && canReconnect && <ReconnectFacebookButton onError={setError} />}
        {needsReauth && isIg && (
          <Link href="/dashboard/settings/channels" className="text-sm text-primary underline">
            前往渠道管理
          </Link>
        )}
      </span>
      {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
    </li>
  );
}

interface Props {
  readiness: CommentReplyReadiness;
  onChanged?: () => void | Promise<unknown>;
}

export function CommentReplyReadinessCard({ readiness, onChanged }: Props) {
  const canUpdate = usePermission('channel.update');
  const canReconnect = usePermission('channel.create');
  const [success, setSuccess] = useState('');
  const [reconnectError, setReconnectError] = useState('');

  const notReceiving = readiness.channels.filter(isNotReceiving);
  const missing = readiness.channels.filter(lacksPermission);
  const testPhase = testPhasePlatforms(readiness);
  const closedPlatforms = (['fb', 'ig'] as const).filter((p) => {
    const cap = p === 'fb' ? readiness.capabilities?.fbPrivateReply : readiness.capabilities?.igPrivateReply;
    return cap === false && readiness.channels.some((c) => platformOf(c.channelType) === p);
  });

  const handleSubscribed = async (channel: CommentReplyReadinessChannel) => {
    setSuccess(`已開啟${channel.displayName}的留言接收`);
    await onChanged?.();
  };

  const nothing =
    !readiness.emergencyStopped && notReceiving.length === 0 && missing.length === 0 && testPhase.length === 0 && closedPlatforms.length === 0 && !success;
  if (nothing) return null;

  return (
    <div className="space-y-3">
      {readiness.emergencyStopped && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-1.5 font-semibold">
            <PauseCircle className="h-4 w-4" aria-hidden="true" />
            <span>平台暫停中</span>
          </div>
          <p className="mt-1">留言自動私訊目前由平台暫停，新留言不會私訊，規則暫時不能修改。恢復時間請洽 open333CRM 客服。</p>
        </div>
      )}

      {closedPlatforms.map((p) => (
        <div key={p} className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          平台尚未開放 {p === 'fb' ? 'Facebook' : 'Instagram'} 留言自動私訊，這類帳號的規則暫時不能建立，留言也不會私訊。
        </div>
      ))}

      {notReceiving.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>{notReceiving.length} 個帳號尚未開啟留言接收，留言不會觸發規則</span>
          </div>
          <ul className="mt-1 text-foreground">
            {notReceiving.map((c) => (
              <NotReceivingRow key={c.channelId} channel={c} onChanged={() => handleSubscribed(c)} />
            ))}
          </ul>
          {!canUpdate && <p className="mt-1">請洽管理員到渠道管理開啟留言接收</p>}
          <p className="mt-1 text-xs">這些帳號是在留言功能推出前連結的。開啟後，只有之後的新留言會觸發。</p>
        </div>
      )}

      {success && (
        <div role="status" className="rounded-md border border-success/30 bg-success-subtle px-4 py-2 text-sm text-success">
          {success}
        </div>
      )}

      {missing.map((c) => {
        const isIg = platformOf(c.channelType) === 'ig';
        return (
          <div key={c.channelId} className="rounded-md border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning">
            {isIg ? (
              <>
                <div className="font-semibold">Instagram 權杖可能缺少留言權限，請重新產生權杖後貼回渠道設定</div>
                <p className="mt-1 text-foreground">{channelTitle(c)}：權杖需要包含 instagram_business_manage_comments 權限。</p>
                <Link href="/dashboard/settings/channels" className="mt-1 inline-block text-primary underline">
                  前往渠道管理
                </Link>
              </>
            ) : (
              <>
                <div className="font-semibold">{c.displayName}缺少必要的授權</div>
                <p className="mt-1 text-foreground">
                  連結 Facebook 時沒有同意「管理粉專貼文互動」與「讀取貼文留言」權限，系統收不到留言也無法私訊。
                  重新連結時，請在 Facebook 的授權畫面保留所有勾選的項目。
                </p>
                <div className="mt-2">
                  {canReconnect ? (
                    <ReconnectFacebookButton onError={setReconnectError} />
                  ) : (
                    <span>請洽管理員到渠道管理重新連結</span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      {reconnectError && <p role="alert" className="text-xs text-destructive">{reconnectError}</p>}

      <CommentReplyTestPhaseCard platforms={testPhase} />
    </div>
  );
}
