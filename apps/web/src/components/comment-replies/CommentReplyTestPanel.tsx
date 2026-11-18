'use client';

/**
 * 規則試算「試試看」（planning/01-ux.md §3.3「規則試算」；spec comment-reply-rules「規則試算不送出」）。
 * 只呼叫 POST /comment-replies/rules/test，不送出任何訊息、不建立紀錄。
 */
import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getApiErrorMessage } from '@/lib/api-error';
import { platformLabel } from '@/lib/comment-reply/codes';
import type { CommentReplyTestResult } from '@/lib/comment-reply/types';
import { testCommentReplyRules } from '@/hooks/useCommentReplies';

interface Props {
  channels: Array<{ channelId: string; channelType: string; displayName: string }>;
  defaultChannelId?: string;
  defaultOpen?: boolean;
}

export function CommentReplyTestPanel({ channels, defaultChannelId, defaultOpen = false }: Props) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [channelId, setChannelId] = useState(defaultChannelId ?? channels[0]?.channelId ?? '');
  const [postId, setPostId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CommentReplyTestResult | null>(null);

  useEffect(() => {
    if (defaultChannelId) setChannelId(defaultChannelId);
  }, [defaultChannelId]);

  const run = async () => {
    setResult(null);
    if (!channelId) {
      setError('請選擇粉專或 IG 帳號');
      return;
    }
    if (!text.trim()) {
      setError('請輸入一段留言文字');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const body: { channelId: string; postId?: string; text: string } = { channelId, text };
      if (postId.trim()) body.postId = postId.trim();
      setResult(await testCommentReplyRules(body));
    } catch (err) {
      setError(getApiErrorMessage(err, '試算失敗，請稍後重試'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-center gap-x-2 px-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 items-center gap-1.5 text-left text-sm font-semibold"
        >
          {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          試試看
        </button>
        <span className="text-sm text-muted-foreground">輸入一段留言，看會不會觸發（只比對，不送出）</span>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-channel`} className="mb-1 block text-xs font-medium">粉專或 IG 帳號</label>
              <select
                id={`${id}-channel`}
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {channels.length === 0 && <option value="">沒有可用的帳號</option>}
                {channels.map((c) => (
                  <option key={c.channelId} value={c.channelId}>{`${platformLabel(c.channelType)} · ${c.displayName}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-post`} className="mb-1 block text-xs font-medium">貼文 ID（選填）</label>
              <Input id={`${id}-post`} value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="不填則視為一般貼文" />
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-text`} className="mb-1 block text-xs font-medium">留言文字</label>
            <Textarea id={`${id}-text`} value={text} maxLength={2000} rows={2} onChange={(e) => setText(e.target.value)} placeholder="例：我要 +1" />
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={run} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              試算
            </Button>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          {result && (
            <div role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {result.matched ? (
                <>
                  <p className="font-medium">{`會套用：規則「${result.ruleName ?? ''}」`}</p>
                  {result.matchedKeywords && result.matchedKeywords.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{`命中的關鍵字：${result.matchedKeywords.join('、')}`}</p>
                  )}
                </>
              ) : (
                <p>不會觸發任何啟用中的規則</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
