'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { CARD, ReportEmpty, ReportError, Skeleton } from './ReportState';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', SUPERVISOR: '客服主管', AGENT: '客服' };

interface AgentData {
  agentId: string;
  name: string;
  role: string;
  casesHandled: number;
  casesResolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAvg: number | null;
  slaAchievementRate: number | null;
}

interface AgentPerformanceTableProps {
  data: AgentData[];
  isLoading: boolean;
  limit?: number;
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  /** 有傳才顯示「查看全部 →」（概覽的 TOP 5 用） */
  onViewAll?: () => void;
}

type SortKey = 'casesHandled' | 'casesResolved' | 'avgFirstResponseMinutes' | 'csatAvg' | 'slaAchievementRate';

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} 分`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} 時 ${m} 分`;
}

export function AgentPerformanceTable({
  data,
  isLoading,
  limit,
  title = '客服績效',
  error,
  onRetry,
  onViewAll,
}: AgentPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('casesHandled');
  const [sortDesc, setSortDesc] = useState(true);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey] ?? -1;
    const bv = b[sortKey] ?? -1;
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const display = limit ? sorted.slice(0, limit) : sorted;

  // 欄位排序：表頭改成按鈕（原本點 th，鍵盤無法操作），並以 aria-sort 告知目前排序（WCAG 2.1.1）
  const cols: Array<{ key: SortKey | null; label: string; align?: 'right' }> = [
    { key: null, label: '客服' },
    { key: 'casesHandled', label: '處理案件', align: 'right' },
    { key: 'casesResolved', label: '已解決', align: 'right' },
    { key: 'avgFirstResponseMinutes', label: '平均首次回應', align: 'right' },
    { key: 'csatAvg', label: 'CSAT', align: 'right' },
    { key: 'slaAchievementRate', label: 'SLA 達成率', align: 'right' },
  ];
  const headingId = `h-agents-${title}`;

  return (
    <section aria-labelledby={headingId} className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-foreground">{title}</h2>
        {onViewAll && (
          <button type="button" onClick={onViewAll} className="text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            查看全部 →
          </button>
        )}
      </div>

      {error && data.length === 0 ? (
        <ReportError label="客服績效" onRetry={onRetry} />
      ) : isLoading ? (
        <div aria-busy="true" aria-label="載入中" className="flex flex-col gap-3">
          {Array.from({ length: limit ?? 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : display.length === 0 ? (
        <ReportEmpty />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    aria-sort={c.key && c.key === sortKey ? (sortDesc ? 'descending' : 'ascending') : undefined}
                    className={c.align === 'right' ? 'text-right' : 'text-left'}
                  >
                    {c.key ? (
                      <button
                        type="button"
                        onClick={() => handleSort(c.key as SortKey)}
                        className={`inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${c.key === sortKey ? 'text-foreground' : ''}`}
                      >
                        {c.label}
                        {c.key === sortKey ? (
                          sortDesc ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.map((agent) => (
                <tr key={agent.agentId}>
                  <td>
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">{agent.name}</span>
                      <span className="text-xs text-muted-foreground">{ROLE_LABEL[agent.role] ?? agent.role}</span>
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{agent.casesHandled.toLocaleString('zh-TW')}</td>
                  <td className="text-right tabular-nums">{agent.casesResolved.toLocaleString('zh-TW')}</td>
                  <td className="text-right tabular-nums">{formatMinutes(agent.avgFirstResponseMinutes)}</td>
                  <td className="text-right tabular-nums">{agent.csatAvg != null ? agent.csatAvg.toFixed(1) : '—'}</td>
                  <td className="text-right tabular-nums">
                    {agent.slaAchievementRate != null ? `${agent.slaAchievementRate.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
