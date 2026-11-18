'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FolderOpen, FolderCheck } from 'lucide-react';
import { CaseStatusBadge } from '@/components/case/CaseStatusBadge';
import { Pagination } from '@/components/shared/Pagination';
import { CARD, ReportError, Skeleton } from './ReportState';

/** 優先級：中文、依緊急程度排序，顏色由深到淺（依 Claude Design「案件報表」） */
const PRIORITY_ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;
const PRIORITY_LABEL: Record<string, string> = { URGENT: '緊急', HIGH: '高', MEDIUM: '中', LOW: '低' };
export const PRIORITY_COLORS = ['#8F1D14', '#C8251B', '#E76F51', '#F2AE9A'];

export function toPriorityDistribution(raw: Array<{ name: string; value: number }>) {
  return PRIORITY_ORDER.map((key) => {
    const hit = raw.find((r) => r.name?.toUpperCase() === key);
    return { name: PRIORITY_LABEL[key], value: hit?.value ?? 0 };
  }).filter((d) => d.value > 0);
}

/** 摘要數字列：新開案、已解決（期間加總）、SLA 違規 */
export function CaseSummary({
  trend,
  violations,
  isLoading,
}: {
  trend: Array<{ opened: number; closed: number }>;
  violations: number;
  isLoading: boolean;
}) {
  const opened = trend.reduce((s, d) => s + (d.opened || 0), 0);
  const closed = trend.reduce((s, d) => s + (d.closed || 0), 0);
  const items = [
    { key: 'opened', label: '新開案', value: opened, icon: FolderOpen, tint: 'bg-primary-subtle text-primary' },
    { key: 'closed', label: '已解決', value: closed, icon: FolderCheck, tint: 'bg-success-subtle text-success' },
    { key: 'sla', label: 'SLA 違規', value: violations, icon: AlertTriangle, tint: violations ? 'bg-destructive-subtle text-destructive' : 'bg-success-subtle text-success', danger: violations > 0 },
  ];
  return (
    <section aria-label="案件摘要" className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {items.map(({ key, label, value, icon: Icon, tint, danger }) => (
        <div key={key} className="flex items-center gap-4 rounded-lg border border-border bg-background p-5">
          <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-[10px] ${tint}`} aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">{label}</span>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-[28px] font-semibold leading-[34px] tabular-nums ${danger ? 'text-destructive' : 'text-foreground'}`}>
                  {value.toLocaleString('zh-TW')}
                </span>
                <span className="text-sm text-muted-foreground">件</span>
                {danger && <span className="text-xs font-semibold text-destructive">需立即處理</span>}
              </span>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

interface Violation {
  id: string;
  title: string;
  status: string;
  slaDueAt?: string | null;
  assignee?: { name?: string } | null;
  contact?: { displayName?: string } | null;
}

const PAGE_SIZE = 10;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function overdueText(ms: number) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `逾期 ${Math.max(1, min)} 分鐘`;
  const h = Math.floor(min / 60);
  if (h < 24) return `逾期 ${h} 小時`;
  return `逾期 ${Math.floor(h / 24)} 天`;
}

type SortKey = 'overdue' | 'title' | 'due';

/**
 * SLA 違規案件 — 依 Claude Design：中文狀態標籤、未指派灰字、數字格式到期時間、逾期時長；
 * 預設依逾期時長由長到短；整列可點擊進入案件詳情（鍵盤 Enter 也可）；超過 10 筆分頁。
 */
export function SlaViolationTable({ data, isLoading, error, onRetry }: { data: Violation[]; isLoading: boolean; error?: unknown; onRetry?: () => void }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'overdue', desc: true });
  const [page, setPage] = useState(1);
  const now = Date.now();

  const rows = useMemo(() => {
    const list = data.map((v) => {
      const due = v.slaDueAt ? new Date(v.slaDueAt) : null;
      return { ...v, due, overdue: due ? now - due.getTime() : 0 };
    });
    list.sort((a, b) => {
      const dir = sort.desc ? -1 : 1;
      if (sort.key === 'title') return a.title.localeCompare(b.title, 'zh-Hant') * dir;
      if (sort.key === 'due') return ((a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)) * dir;
      return (a.overdue - b.overdue) * dir;
    });
    return list;
  }, [data, sort, now]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sortBy = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'title' }));
    setPage(1);
  };
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined);
  const SortBtn = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <button type="button" onClick={() => sortBy(k)} className={`inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sort.key === k ? 'text-foreground' : ''}`}>
      {children}
      <span aria-hidden="true" className="text-[10px]">{sort.key === k ? (sort.desc ? '▼' : '▲') : '↕'}</span>
    </button>
  );

  return (
    <section aria-labelledby="h-sla" className={CARD}>
      <div className="flex items-center gap-2">
        <h2 id="h-sla" className="text-lg font-semibold text-foreground">SLA 違規案件</h2>
        {!isLoading && data.length > 0 && (
          <span className="rounded-full bg-destructive-subtle px-2.5 py-0.5 text-xs font-semibold tabular-nums text-destructive">{data.length} 件</span>
        )}
      </div>

      {error && data.length === 0 ? (
        <ReportError label="SLA 違規案件" onRetry={onRetry} />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">目前沒有 SLA 違規案件</span>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" aria-sort={ariaSort('title')} className="text-left"><SortBtn k="title">案件標題</SortBtn></th>
                  <th scope="col" className="text-left">狀態</th>
                  <th scope="col" className="text-left">指派客服</th>
                  <th scope="col" className="text-left">聯繫人</th>
                  <th scope="col" aria-sort={ariaSort('due')} className="text-left"><SortBtn k="due">SLA 到期時間</SortBtn></th>
                  <th scope="col" aria-sort={ariaSort('overdue')} className="text-left"><SortBtn k="overdue">逾期時長</SortBtn></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <tr
                    key={v.id}
                    tabIndex={0}
                    onClick={() => router.push(`/dashboard/cases/${v.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/dashboard/cases/${v.id}`); }}
                    className="cursor-pointer focus-visible:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={`查看案件「${v.title}」`}
                  >
                    <td className="max-w-[320px] truncate font-medium text-foreground" title={v.title}>{v.title}</td>
                    <td><CaseStatusBadge status={v.status} /></td>
                    <td>{v.assignee?.name || <span className="text-muted-foreground">未指派</span>}</td>
                    <td className="truncate">{v.contact?.displayName || <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap tabular-nums">{v.due ? fmt(v.due) : '—'}</td>
                    <td className="whitespace-nowrap font-medium text-destructive">{v.overdue > 0 ? overdueText(v.overdue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">共 {rows.length} 件</span>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
