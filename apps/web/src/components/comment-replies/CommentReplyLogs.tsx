'use client';

/**
 * 觸發紀錄分頁（planning/01-ux.md §4、§11.6；design D8 狀態與原因代碼）。
 *
 * - 篩選條件同步到網址（?tab=logs&status=FAILED,EXPIRED&channelId=&ruleId=&range=7d&q=&logId=）。
 * - 每 30 秒查一次新紀錄數，不直接插入表格（避免正在看的列跳動），改顯示「有 N 筆新紀錄」。
 * - 留言內容一律以文字節點渲染（React 會跳脫），不使用 innerHTML。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChannelLogo } from '@/components/shared/ChannelLogo';
import { cn } from '@/lib/utils';
import { usePermission } from '@/providers/AuthProvider';
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage } from '@/lib/api-error';
import { pad2, taipeiParts } from '@/lib/taipei-time';
import {
  COMMENT_REPLY_REASON_ACTIONS,
  COMMENT_REPLY_STATUS_FILTERS,
  PUBLIC_REPLY_REASON_LABELS,
  PUBLIC_REPLY_STATUS_LABELS,
  platformLabel,
  platformOf,
  reasonLabel,
  statusDisplay,
} from '@/lib/comment-reply/codes';
import type { CommentReplyLogDetail, CommentReplyLogItem, CommentReplyRuleView } from '@/lib/comment-reply/types';
import {
  type CommentReplyLogFilters,
  type CommentReplyLogSummary,
  countNewCommentReplyLogs,
  fetchCommentReplyLogDetail,
  fetchCommentReplyLogSummary,
  fetchCommentReplyLogs,
  retryCommentReplyLog,
} from '@/hooks/useCommentReplies';

const POLL_MS = 30_000;
const SLOW_PENDING_MS = 5 * 60 * 1000;
const RETRY_CONFIRM = '確定重新私訊這位留言者？Meta 每則留言只允許私訊一次，若先前其實已送達，這次會失敗。';

type Range = 'today' | '7d' | '30d';
const RANGES: Array<{ value: Range; label: string; days: number }> = [
  { value: 'today', label: '今天', days: 1 },
  { value: '7d', label: '7 天', days: 7 },
  { value: '30d', label: '30 天', days: 30 },
];

/** 期間起點：台灣時間 N 天前（含今天）的 00:00 */
function rangeStart(range: Range, now = new Date()): string {
  const days = RANGES.find((r) => r.value === range)?.days ?? 7;
  const p = taipeiParts(now);
  if (!p) return new Date(now.getTime() - days * 86_400_000).toISOString();
  const taipeiMidnightUtc = Date.UTC(p.year, p.month - 1, p.day) - 8 * 3_600_000;
  return new Date(taipeiMidnightUtc - (days - 1) * 86_400_000).toISOString();
}

function formatTaipei(value?: string | null): string {
  const p = taipeiParts(value ?? null);
  return p ? `${p.year}/${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}` : '';
}

function commenterLabel(log: CommentReplyLogItem): string {
  if (log.commenterName) return log.commenterName;
  if (log.commenterUsername) return `@${log.commenterUsername}`;
  return '（未知留言者）';
}

/** 命中的關鍵字以底色標示；全部以文字節點輸出 */
function Highlighted({ text, keywords, max }: { text: string; keywords: string[]; max?: number }) {
  const shown = max && text.length > max ? `${text.slice(0, max)}…` : text;
  const words = keywords.filter(Boolean);
  if (words.length === 0) return <>{shown}</>;
  const lower = shown.toLowerCase();
  const parts: Array<{ text: string; hit: boolean }> = [];
  let i = 0;
  while (i < shown.length) {
    let hitLen = 0;
    for (const w of words) {
      if (lower.startsWith(w.toLowerCase(), i) && w.length > hitLen) hitLen = w.length;
    }
    if (hitLen > 0) {
      parts.push({ text: shown.slice(i, i + hitLen), hit: true });
      i += hitLen;
    } else {
      const last = parts[parts.length - 1];
      if (last && !last.hit) last.text += shown[i];
      else parts.push({ text: shown[i], hit: false });
      i += 1;
    }
  }
  return (
    <>
      {parts.map((part, idx) => (part.hit ? <mark key={idx} className="rounded bg-primary-subtle px-0.5 text-primary">{part.text}</mark> : <React.Fragment key={idx}>{part.text}</React.Fragment>))}
    </>
  );
}

function StatusPill({ status, reasonCode }: { status: string; reasonCode?: string | null }) {
  const { label, tone } = statusDisplay(status, reasonCode);
  return (
    <span data-testid="cr-status-pill" className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
      {label}
    </span>
  );
}

function customerReplied(log: CommentReplyLogItem): boolean {
  return Boolean(log.customerReplied || log.customerRepliedAt || log.conversationId);
}

function resultText(log: CommentReplyLogItem): { text: string; tone?: string } {
  if (log.status === 'SENT') {
    if (log.reasonCode === 'SENT_UNCONFIRMED') return { text: reasonLabel(log.reasonCode) };
    return customerReplied(log) ? { text: '顧客已回覆' } : { text: '尚未回覆', tone: 'text-muted-foreground' };
  }
  if (log.status === 'SKIPPED_DUPLICATE') return { text: '這位留言者已私訊過', tone: 'text-muted-foreground' };
  if ((log.status === 'PENDING' || log.status === 'SENDING') && !log.reasonCode) {
    const since = new Date(log.receivedAt ?? log.commentCreatedAt).getTime();
    if (Number.isFinite(since) && Date.now() - since > SLOW_PENDING_MS) return { text: '處理時間比平常久', tone: 'text-warning' };
    return { text: '' };
  }
  if (!log.reasonCode) return { text: log.status === 'FAILED' ? reasonLabel('UNKNOWN') : '' };
  return { text: reasonLabel(log.reasonCode, log.reasonMessage), tone: log.status === 'FAILED' ? 'text-destructive' : undefined };
}

/** 私訊內容快照：文字直接顯示，其他型態只顯示摘要 */
function snapshotText(snapshot: unknown): string {
  if (!snapshot) return '';
  if (typeof snapshot === 'string') return snapshot;
  if (typeof snapshot === 'object') {
    const obj = snapshot as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.preview === 'string') return obj.preview;
    if (typeof obj.name === 'string') return `素材：${obj.name}`;
  }
  return '（這則內容無法在這裡預覽）';
}

interface Props {
  channels: Array<{ channelId: string; channelType: string; displayName: string }>;
  rules: CommentReplyRuleView[];
  canManage: boolean;
  /** 摘要更新時通知頁面（分頁標籤的失敗數） */
  onSummary?: (summary: CommentReplyLogSummary) => void;
}

interface UiFilters {
  statusValues: string[];
  channelId: string;
  ruleId: string;
  range: Range;
  q: string;
}

function readFilters(params: URLSearchParams): UiFilters {
  const known = new Set(COMMENT_REPLY_STATUS_FILTERS.map((f) => f.value));
  const range = params.get('range') as Range | null;
  return {
    statusValues: (params.get('status') ?? '').split(',').filter((s) => known.has(s)),
    channelId: params.get('channelId') ?? '',
    ruleId: params.get('ruleId') ?? '',
    range: range && RANGES.some((r) => r.value === range) ? range : '7d',
    q: params.get('q') ?? '',
  };
}

function toApiFilters(f: UiFilters): CommentReplyLogFilters {
  const statuses = COMMENT_REPLY_STATUS_FILTERS.filter((x) => f.statusValues.includes(x.value)).flatMap((x) => x.statuses);
  return {
    statuses,
    channelId: f.channelId || undefined,
    ruleId: f.ruleId || undefined,
    from: rangeStart(f.range),
    q: f.q.trim() || undefined,
  };
}

export function CommentReplyLogs({ channels, rules, canManage, onSummary }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canInbox = usePermission('inbox.view');

  const [filters, setFilters] = useState<UiFilters>(() => readFilters(new URLSearchParams(searchParams?.toString() ?? '')));
  const [qInput, setQInput] = useState(filters.q);
  const [items, setItems] = useState<CommentReplyLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<CommentReplyLogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [newCount, setNewCount] = useState(0);
  const [openLogId, setOpenLogId] = useState<string | null>(() => searchParams?.get('logId') ?? null);
  const [reloadKey, setReloadKey] = useState(0);

  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;

  /** 篩選與開啟中的紀錄寫回網址 */
  const syncUrl = useCallback(
    (f: UiFilters, logId: string | null) => {
      const params = new URLSearchParams({ tab: 'logs' });
      if (f.statusValues.length) params.set('status', f.statusValues.join(','));
      if (f.channelId) params.set('channelId', f.channelId);
      if (f.ruleId) params.set('ruleId', f.ruleId);
      if (f.range !== '7d') params.set('range', f.range);
      if (f.q.trim()) params.set('q', f.q.trim());
      if (logId) params.set('logId', logId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const updateFilters = (patch: Partial<UiFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    syncUrl(next, openLogId);
  };

  // 讀第一頁與摘要
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setNewCount(0);
    (async () => {
      try {
        const [page, rawSummary] = await Promise.all([
          fetchCommentReplyLogs(apiFilters),
          // 摘要載入失敗不影響列表
          fetchCommentReplyLogSummary(apiFilters).catch(() => null),
        ]);
        if (cancelled) return;
        setItems(page.items ?? []);
        setNextCursor(page.nextCursor ?? null);
        if (rawSummary) {
          setSummary(rawSummary);
          onSummaryRef.current?.(rawSummary);
        }
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, '觸發紀錄載入失敗，請稍後重試'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiFilters, reloadKey]);

  // 每 30 秒查新紀錄數
  const newest = items[0]?.receivedAt ?? items[0]?.commentCreatedAt ?? null;
  useEffect(() => {
    if (!newest) return;
    const timer = window.setInterval(async () => {
      try {
        setNewCount(await countNewCommentReplyLogs(apiFilters, newest));
      } catch {
        // 輪詢失敗不打擾使用者；下一次再試
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [apiFilters, newest]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchCommentReplyLogs(apiFilters, nextCursor);
      setItems((prev) => [...prev, ...(page.items ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      setError(getApiErrorMessage(err, '載入更多失敗，請稍後重試'));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleStatus = (value: string) => {
    const has = filters.statusValues.includes(value);
    updateFilters({ statusValues: has ? filters.statusValues.filter((v) => v !== value) : [...filters.statusValues, value] });
  };

  const openDetail = (id: string) => {
    setOpenLogId(id);
    syncUrl(filters, id);
  };
  const closeDetail = () => {
    setOpenLogId(null);
    syncUrl(filters, null);
  };

  const hasFilters = filters.statusValues.length > 0 || Boolean(filters.channelId || filters.ruleId || filters.q.trim()) || filters.range !== '7d';
  const summaryItems: Array<{ value: string; label: string; count: number }> = summary
    ? [
        { value: 'SENT', label: '已送出', count: summary.counts.SENT ?? 0 },
        { value: 'FAILED', label: '失敗', count: summary.counts.FAILED ?? 0 },
        { value: 'EXPIRED', label: '已過期', count: summary.counts.EXPIRED ?? 0 },
        { value: 'SKIPPED_DUPLICATE', label: '已私訊過', count: summary.counts.SKIPPED_DUPLICATE ?? 0 },
      ]
    : [];

  return (
    <div className="space-y-3">
      {/* 篩選 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">期間</span>
          <select value={filters.range} onChange={(e) => updateFilters({ range: e.target.value as Range })} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">渠道</span>
          <select value={filters.channelId} onChange={(e) => updateFilters({ channelId: e.target.value })} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">全部</option>
            {channels.map((c) => <option key={c.channelId} value={c.channelId}>{`${platformLabel(c.channelType)} · ${c.displayName}`}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">規則</span>
          <select value={filters.ruleId} onChange={(e) => updateFilters({ ruleId: e.target.value })} className="h-10 max-w-[200px] rounded-md border border-input bg-background px-2 text-sm">
            <option value="">全部</option>
            {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <form
          className="flex min-w-[220px] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            updateFilters({ q: qInput.slice(0, 100) });
          }}
        >
          <Input value={qInput} maxLength={100} onChange={(e) => setQInput(e.target.value)} placeholder="搜尋留言者或留言內容" aria-label="搜尋留言者或留言內容" />
          <Button type="submit" variant="outline">搜尋</Button>
        </form>
      </div>

      <div role="group" aria-label="依狀態篩選" className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={filters.statusValues.length === 0}
          onClick={() => updateFilters({ statusValues: [] })}
          className={pillClass(filters.statusValues.length === 0)}
        >
          全部
        </button>
        {COMMENT_REPLY_STATUS_FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={filters.statusValues.includes(f.value)} onClick={() => toggleStatus(f.value)} className={pillClass(filters.statusValues.includes(f.value))}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-1">
          {summaryItems.map((s, i) => (
            <React.Fragment key={s.value}>
              {i > 0 && <span className="text-muted-foreground">·</span>}
              <button type="button" className="hover:underline" onClick={() => updateFilters({ statusValues: [s.value] })}>
                {`${s.label} ${s.count.toLocaleString('en-US')}`}
              </button>
            </React.Fragment>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">每 30 秒檢查新紀錄</span>
      </div>

      {newCount > 0 && (
        <div className="flex items-center justify-between rounded-md border border-primary-border bg-primary-subtle px-3 py-2 text-sm text-primary">
          <span>{`有 ${newCount} 筆新紀錄`}</span>
          <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
            顯示
          </Button>
        </div>
      )}

      {error && <div role="alert" className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-input bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {hasFilters ? (
            <>
              <p>沒有符合條件的紀錄</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setQInput('');
                  updateFilters({ statusValues: [], channelId: '', ruleId: '', q: '', range: '7d' });
                }}
              >
                清除篩選
              </Button>
            </>
          ) : (
            <p>還沒有任何留言觸發規則。只有命中啟用中規則的留言會記錄在這裡；沒有命中的留言不會記錄。想確認某段留言會不會觸發，可以用「規則」分頁的「試試看」。</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">時間</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
                <th className="px-3 py-2 text-left font-medium">留言者</th>
                <th className="px-3 py-2 text-left font-medium">留言內容</th>
                <th className="px-3 py-2 text-left font-medium">貼文</th>
                <th className="px-3 py-2 text-left font-medium">規則</th>
                <th className="px-3 py-2 text-left font-medium">渠道</th>
                <th className="px-3 py-2 text-left font-medium">結果說明</th>
                <th className="px-3 py-2"><span className="sr-only">詳情</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((log) => {
                const result = resultText(log);
                const name = commenterLabel(log);
                return (
                  <tr key={log.id} className="cursor-pointer hover:bg-accent/40" onClick={() => openDetail(log.id)}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs" title={log.processedAt ? `系統處理時間：${formatTaipei(log.processedAt)}` : undefined}>
                      {formatTaipei(log.commentCreatedAt)}
                    </td>
                    <td className="px-3 py-2"><StatusPill status={log.status} reasonCode={log.reasonCode} /></td>
                    <td className="px-3 py-2">
                      {log.conversationId && canInbox ? (
                        <Link href={`/dashboard/inbox?conv=${log.conversationId}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <Highlighted text={log.commentText ?? ''} keywords={log.matchedKeywords ?? []} max={60} />
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-xs">
                      {log.post ? (log.post.excerpt ? log.post.excerpt.slice(0, 20) : log.post.postId) : '（已刪除的貼文）'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!log.rule || log.rule.deleted ? (
                        '（已刪除的規則）'
                      ) : (
                        <Link href={`/dashboard/comment-replies/${log.rule.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {log.rule.name}
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {log.channel && (
                        <span className="inline-flex items-center gap-1">
                          <ChannelLogo channelType={log.channel.channelType} className="h-3.5 w-3.5" />
                          {log.channel.displayName}
                        </span>
                      )}
                    </td>
                    <td className={cn('px-3 py-2 text-xs', result.tone)}>{result.text}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`查看 ${name} 的紀錄`}
                        className="text-xs text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(log.id);
                        }}
                      >
                        詳情
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && !loading && (
        <div className="text-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            載入更多
          </Button>
        </div>
      )}

      {openLogId && (
        <LogDetailDrawer
          logId={openLogId}
          canManage={canManage}
          canInbox={canInbox}
          onClose={closeDetail}
          onRetried={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

function pillClass(active: boolean) {
  return active
    ? 'rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
    : 'rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground hover:text-foreground';
}

function LogDetailDrawer({
  logId,
  canManage,
  canInbox,
  onClose,
  onRetried,
}: {
  logId: string;
  canManage: boolean;
  canInbox: boolean;
  onClose: () => void;
  onRetried: () => void;
}) {
  const [detail, setDetail] = useState<CommentReplyLogDetail | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retrying, setRetrying] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setDetail(await fetchCommentReplyLogDetail(logId));
    } catch (err) {
      setError(getApiErrorCode(err) === 'LOG_NOT_FOUND' ? '找不到這筆紀錄' : getApiErrorMessage(err, '紀錄載入失敗，請稍後重試'));
    }
  }, [logId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const retry = async () => {
    if (!window.confirm(RETRY_CONFIRM)) return;
    setRetrying(true);
    setMessage('');
    setError('');
    try {
      await retryCommentReplyLog(logId);
      setMessage('已重新排入處理');
      onRetried();
      await load();
    } catch (err) {
      const reason = getApiErrorDetails(err)?.reason;
      setError(
        getApiErrorCode(err) === 'RETRY_NOT_ALLOWED'
          ? reason === 'EXPIRED'
            ? '留言已超過 7 天，無法重試'
            : reason === 'NOT_FAILED'
              ? '這筆紀錄不是失敗狀態，不需要重試'
              : '這個失敗原因無法重試'
          : getApiErrorMessage(err, '重試失敗，請稍後再試'),
      );
    } finally {
      setRetrying(false);
    }
  };

  const platformName = detail?.channel ? (platformOf(detail.channel.channelType) === 'ig' ? 'Instagram' : 'Facebook') : 'Facebook';
  const action = detail?.reasonCode ? COMMENT_REPLY_REASON_ACTIONS[detail.reasonCode] ?? null : null;
  const canRetry = canManage && detail?.status === 'FAILED' && detail.retryable === true;
  const replied = detail ? customerReplied(detail) : false;
  const result = detail ? resultText(detail) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="關閉留言紀錄" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="留言紀錄" className="relative flex h-full w-full flex-col bg-background shadow-xl sm:w-[480px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">留言紀錄</h2>
          <button ref={closeRef} type="button" aria-label="關閉" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
          {error && <div role="alert" className="rounded-md bg-destructive-subtle px-3 py-2 text-destructive">{error}</div>}
          {message && <div role="status" className="rounded-md bg-success-subtle px-3 py-2 text-success">{message}</div>}
          {!detail && !error && <p className="text-muted-foreground">載入中…</p>}
          {detail && (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={detail.status} reasonCode={detail.reasonCode} />
                  {/* 已送出的回覆狀況寫在下方「後續對話」，這裡不重複 */}
                  {result?.text && !(detail.status === 'SENT' && detail.reasonCode !== 'SENT_UNCONFIRMED') && <span className={result.tone}>{result.text}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {action === 'reconnect' && (
                    <Link href="/dashboard/settings/channels" className="text-primary underline">重新連結 {platformName}</Link>
                  )}
                  {action === 'editRule' && detail.rule && !detail.rule.deleted && (
                    <Link href={`/dashboard/comment-replies/${detail.rule.id}`} className="text-primary underline">編輯規則</Link>
                  )}
                  {action === 'testPhaseInfo' && (
                    <span className="text-xs text-muted-foreground">App 審核通過前，只有測試人員的留言會收到私訊。</span>
                  )}
                  {canRetry && (
                    <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
                      {retrying && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
                      重試
                    </Button>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">留言</h3>
                <p className="mt-1">{`${commenterLabel(detail)} · ${formatTaipei(detail.commentCreatedAt)}`}</p>
                <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-3 py-2">
                  {detail.commentText ? <Highlighted text={detail.commentText} keywords={detail.matchedKeywords ?? []} /> : <span className="text-muted-foreground">（留言內容已刪除）</span>}
                </p>
                {detail.isReplyToComment && <p className="mt-1 text-xs text-muted-foreground">這是對另一則留言的回覆</p>}
                {detail.commentPermalink && (
                  <a href={detail.commentPermalink} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-0.5 text-xs text-primary">
                    在 {platformName} 開啟留言 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">貼文</h3>
                {detail.post ? (
                  <>
                    <p className="mt-1">{detail.post.excerpt ? detail.post.excerpt.slice(0, 100) : detail.post.postId}</p>
                    {detail.post.permalink && (
                      <a href={detail.post.permalink} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-0.5 text-xs text-primary">
                        在 {platformName} 開啟貼文 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-muted-foreground">（已刪除的貼文）</p>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">{detail.status === 'SENT' ? '私訊內容' : '私訊內容（未送出）'}</h3>
                {detail.sentContentSnapshot ? (
                  <p className="mt-1 whitespace-pre-wrap rounded-lg rounded-tr-none bg-primary-subtle px-3 py-2">{snapshotText(detail.sentContentSnapshot)}</p>
                ) : (
                  <p className="mt-1 text-muted-foreground">沒有私訊內容紀錄</p>
                )}
                {detail.sentAt && <p className="mt-1 text-xs text-muted-foreground">{`送出時間：${formatTaipei(detail.sentAt)}`}</p>}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">公開回覆</h3>
                <p className="mt-1">
                  {PUBLIC_REPLY_STATUS_LABELS[detail.publicReplyStatus ?? 'NOT_CONFIGURED'] ?? '未設定'}
                  {detail.publicReplyReasonCode && `（${PUBLIC_REPLY_REASON_LABELS[detail.publicReplyReasonCode] ?? PUBLIC_REPLY_REASON_LABELS.UNKNOWN}）`}
                </p>
                {detail.publicReplyText && <p className="mt-1 rounded-md border border-border px-3 py-2">{detail.publicReplyText}</p>}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">後續對話</h3>
                {replied ? (
                  <>
                    <p className="mt-1">{detail.customerRepliedAt ? `顧客已回覆（${formatTaipei(detail.customerRepliedAt)}）` : '顧客已回覆'}</p>
                    {detail.conversationId && canInbox && (
                      <Link href={`/dashboard/inbox?conv=${detail.conversationId}`} className="mt-1 inline-block text-primary underline">
                        到收件匣查看對話
                      </Link>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-muted-foreground">顧客還沒有回覆。顧客回覆後，對話才會出現在收件匣，24 小時內可以由客服接手。</p>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">規則</h3>
                {!detail.rule || detail.rule.deleted ? (
                  <p className="mt-1">（已刪除的規則）</p>
                ) : (
                  <Link href={`/dashboard/comment-replies/${detail.rule.id}`} className="mt-1 inline-block text-primary underline">{detail.rule.name}</Link>
                )}
              </section>

              <details className="rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">技術資訊</summary>
                <dl className="mt-2 space-y-1 font-mono text-xs">
                  <div>留言 ID：{detail.commentId}</div>
                  {detail.post?.postId && <div>貼文 ID：{detail.post.postId}</div>}
                  {detail.reasonCode && <div>原因代碼：{detail.reasonCode}</div>}
                  {detail.metaErrorCode != null && <div>Meta 錯誤碼：{detail.metaErrorCode}{detail.metaErrorSubcode != null ? ` / ${detail.metaErrorSubcode}` : ''}</div>}
                  {detail.reasonMessage && <div className="break-all">Meta 訊息：{detail.reasonMessage}</div>}
                </dl>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
