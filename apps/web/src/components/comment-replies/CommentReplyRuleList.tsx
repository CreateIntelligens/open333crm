'use client';

/**
 * 留言自動私訊規則列表（planning/01-ux.md §3.1、§8.1）。
 *
 * - 只有 view：沒有建立、排序、刪除、狀態切換；動作只有「查看」「查看紀錄」。
 * - 能不能改某條規則看後端算好的 `canEdit`（manage 權限＋渠道存取層級），前端不自行推算。
 * - 排序：上移／下移後送出「可編輯規則」的完整順序（spec「規則的優先順序」：集合必須與檢視者可編輯的規則相同）。
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Power, PowerOff } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ChannelLogo } from '@/components/shared/ChannelLogo';
import { cn } from '@/lib/utils';
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage } from '@/lib/api-error';
import { platformLabel, ruleWarningLabel } from '@/lib/comment-reply/codes';
import type { CommentReplyRuleView } from '@/lib/comment-reply/types';
import {
  deleteCommentReplyRule,
  reorderCommentReplyRules,
  setCommentReplyRuleActive,
} from '@/hooks/useCommentReplies';

interface Props {
  rules: CommentReplyRuleView[];
  canManage: boolean;
  /** 只顯示某個渠道的規則；不帶表示全部 */
  channelFilter?: string;
  onChanged: () => void | Promise<unknown>;
}

const NEW_HREF = '/dashboard/comment-replies/new';

function logsHref(ruleId: string, status?: string) {
  const params = new URLSearchParams({ tab: 'logs', ruleId });
  if (status) params.set('status', status);
  return `/dashboard/comment-replies?${params.toString()}`;
}

function contentSummary(rule: CommentReplyRuleView): { text: string; warn?: string } {
  if (rule.content.type === 'material') {
    const name = rule.content.materialName ?? '（已刪除的素材）';
    const inactive = !rule.content.materialId || (rule.content.materialStatus && rule.content.materialStatus !== 'ACTIVE');
    return { text: `素材：${name}`, warn: inactive ? '素材已停用，不會送出' : undefined };
  }
  const text = rule.content.text ?? '';
  return { text: `文字：${text.length > 20 ? `${text.slice(0, 20)}…` : text}` };
}

function postScopeSummary(rule: CommentReplyRuleView): { text: string; title?: string } {
  if (rule.postScope === 'all') return { text: '全部貼文' };
  return {
    text: `${rule.posts.length} 篇貼文`,
    title: rule.posts.map((p) => p.excerpt || p.postId).join('\n'),
  };
}

/** 限制錯誤訊息：PLAN_LIMIT_EXCEEDED 帶出上限數字 */
function toggleErrorMessage(err: unknown): string {
  if (getApiErrorCode(err) === 'PLAN_LIMIT_EXCEEDED') {
    const max = getApiErrorDetails(err)?.max;
    return typeof max === 'number'
      ? `啟用中的留言規則已達方案上限（${max} 條）。請先停用其他規則，或洽管理員升級方案。`
      : '啟用中的留言規則已達方案上限。請先停用其他規則，或洽管理員升級方案。';
  }
  if (getApiErrorCode(err) === 'CHANNEL_ACCESS_DENIED') return '你對這個渠道只有檢視權限，無法修改這條規則';
  return getApiErrorMessage(err, '更新失敗，請稍後重試');
}

export function CommentReplyRuleList({ rules, canManage, channelFilter, onChanged }: Props) {
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const visible = channelFilter ? sorted.filter((r) => r.channelId === channelFilter) : sorted;
  // 排序只在可編輯的規則之間進行
  const editableIds = sorted.filter((r) => r.canEdit).map((r) => r.id);

  const move = async (rule: CommentReplyRuleView, direction: -1 | 1) => {
    const visibleEditable = visible.filter((r) => r.canEdit);
    const idx = visibleEditable.findIndex((r) => r.id === rule.id);
    const neighbor = visibleEditable[idx + direction];
    if (!neighbor) return;
    const ids = [...editableIds];
    const a = ids.indexOf(rule.id);
    const b = ids.indexOf(neighbor.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    setBusy(true);
    setMessage(null);
    try {
      await reorderCommentReplyRules(ids);
      await onChanged();
    } catch (err) {
      if (getApiErrorCode(err) === 'RULE_ORDER_MISMATCH') {
        setMessage({ tone: 'error', text: '規則清單已變更，已重新載入，請再調整一次順序' });
        await onChanged();
      } else {
        setMessage({ tone: 'error', text: getApiErrorMessage(err, '調整順序失敗，請稍後重試') });
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule: CommentReplyRuleView) => {
    setMessage(null);
    try {
      await setCommentReplyRuleActive(rule.id, !rule.isActive);
      await onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: toggleErrorMessage(err) });
    }
  };

  const remove = async (rule: CommentReplyRuleView) => {
    if (!window.confirm(`確定刪除規則「${rule.name}」？刪除後不再觸發，已有的觸發紀錄會保留。`)) return;
    setMessage(null);
    try {
      await deleteCommentReplyRule(rule.id);
      await onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: getApiErrorMessage(err, '刪除失敗，請稍後重試') });
    }
  };

  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-input bg-white py-16 text-center">
        <h2 className="text-base font-semibold">尚未建立任何留言自動私訊規則</h2>
        <p className="mt-1 text-sm text-muted-foreground">顧客在貼文留言出現關鍵字時，系統會自動私訊他一則訊息。</p>
        {canManage && (
          <Link href={NEW_HREF} className={buttonVariants({ className: 'mt-4' })}>
            建立第一條規則
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message && (
        <div role="alert" className={cn('rounded-md px-3 py-2 text-sm', message.tone === 'error' ? 'bg-destructive-subtle text-destructive' : 'bg-muted')}>
          {message.text}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-input bg-white py-10 text-center text-sm text-muted-foreground">
          這個帳號還沒有留言自動私訊規則
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">順序</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
                <th className="px-3 py-2 text-left font-medium">規則名稱</th>
                <th className="px-3 py-2 text-left font-medium">渠道</th>
                <th className="px-3 py-2 text-left font-medium">關鍵字</th>
                <th className="px-3 py-2 text-left font-medium">貼文範圍</th>
                <th className="px-3 py-2 text-left font-medium">私訊內容</th>
                <th className="px-3 py-2 text-left font-medium">公開回覆</th>
                <th className="px-3 py-2 text-left font-medium">近 7 天</th>
                <th className="px-3 py-2 text-right font-medium">動作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((rule) => {
                const editable = canManage && rule.canEdit;
                const order = sorted.indexOf(rule) + 1;
                const visibleEditable = visible.filter((r) => r.canEdit);
                const editableIdx = visibleEditable.findIndex((r) => r.id === rule.id);
                const content = contentSummary(rule);
                const scope = postScopeSummary(rule);
                return (
                  <tr key={rule.id} className={rule.isActive ? '' : 'opacity-50'}>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-1">
                        <span className="w-5 text-center tabular-nums">{order}</span>
                        {editable && (
                          <span className="flex flex-col">
                            <button
                              type="button"
                              aria-label={`上移「${rule.name}」`}
                              disabled={busy || editableIdx <= 0}
                              onClick={() => move(rule, -1)}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`下移「${rule.name}」`}
                              disabled={busy || editableIdx === visibleEditable.length - 1}
                              onClick={() => move(rule, 1)}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => toggle(rule)}
                          aria-label={rule.isActive ? `停用規則「${rule.name}」` : `啟用規則「${rule.name}」`}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                            rule.isActive ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {rule.isActive ? <Power className="h-3 w-3" aria-hidden="true" /> : <PowerOff className="h-3 w-3" aria-hidden="true" />}
                          {rule.isActive ? '啟用' : '停用'}
                        </button>
                      ) : (
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs', rule.isActive ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground')}>
                          {rule.isActive ? '啟用' : '停用'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold">{rule.name}</div>
                      {canManage && !rule.canEdit && <div className="text-xs text-muted-foreground">你對這個渠道只有檢視權限</div>}
                      {rule.warnings.map((w) => (
                        <div key={w} className="text-xs text-warning">{ruleWarningLabel(w)}</div>
                      ))}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <ChannelLogo channelType={rule.channel.channelType} className="h-4 w-4" />
                        <span>{`${platformLabel(rule.channel.channelType)} · ${rule.channel.displayName}`}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {rule.keywords.slice(0, 5).map((k) => (
                          <span key={k} className="inline-flex rounded-full border border-primary-border bg-primary-subtle px-2 py-0.5 text-[11px] text-primary">
                            {k}
                          </span>
                        ))}
                        {rule.keywords.length > 5 && <span className="text-[11px] text-muted-foreground">+{rule.keywords.length - 5}</span>}
                        {rule.keywords.length > 1 && (
                          <span className="text-[11px] text-muted-foreground">（{rule.matchMode === 'all' ? '全部' : '任一'}）</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top" title={scope.title}>{scope.text}</td>
                    <td className="px-3 py-3 align-top">
                      <div className="text-xs">{content.text}</div>
                      {content.warn && <div className="text-xs text-warning">{content.warn}</div>}
                    </td>
                    <td className="px-3 py-3 align-top">{rule.publicReply.enabled ? '有' : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs">
                      <Link href={logsHref(rule.id, 'SENT')} className="hover:underline">{`送出 ${rule.stats7d.sent}`}</Link>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <Link href={logsHref(rule.id, 'FAILED')} className={cn('hover:underline', rule.stats7d.failed > 0 && 'text-destructive')}>
                        {`失敗 ${rule.stats7d.failed}`}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right align-top">
                      <Link href={`/dashboard/comment-replies/${rule.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        {editable ? '編輯' : '查看'}
                      </Link>
                      <Link href={logsHref(rule.id)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        查看紀錄
                      </Link>
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`刪除「${rule.name}」`}
                          className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
                          onClick={() => remove(rule)}
                        >
                          刪除
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">同一則留言只會套用排在最前面、且命中的那一條規則。每則留言最多私訊一次。</p>
    </div>
  );
}
