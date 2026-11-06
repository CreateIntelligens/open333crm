'use client';

import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CARD, ReportEmpty, ReportError, Skeleton } from './ReportState';

interface CaseCategoryPieChartProps {
  data: Array<{ name: string; value: number }>;
  title?: string;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

// 色票依 Claude Design（主色、深橘、灰藍…），相鄰色明度差夠大，色弱也能靠圖例的件數與百分比分辨
const COLORS = ['#2876C4', '#D9480F', '#94A3B8', '#0F766E', '#8A5A00', '#475569', '#C8251B', '#5F6B7E'];

/** 案件分類分布 — 依 Claude Design：甜甜圈圖（中間總件數）＋右側圖例（名稱、件數、百分比） */
export function CaseCategoryPieChart({ data, title = '案件分類分布', isLoading, error, onRetry }: CaseCategoryPieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const id = `h-cat-${title}`;

  return (
    <section aria-labelledby={id} className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold text-foreground">{title}</h2>
        {!isLoading && total > 0 && <span className="text-xs text-muted-foreground">共 {total.toLocaleString('zh-TW')} 件</span>}
      </div>

      {error && data.length === 0 ? (
        <ReportError label="案件分類" onRetry={onRetry} />
      ) : isLoading ? (
        <div aria-busy="true" aria-label="載入中" className="flex items-center gap-6 py-4">
          <Skeleton className="h-[180px] w-[180px] rounded-full" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : total === 0 ? (
        <ReportEmpty />
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative h-[200px] w-[200px] flex-none">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={92} paddingAngle={1} stroke="none" isAnimationActive={false}>
                  {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[28px] font-bold leading-8 tabular-nums text-foreground">{total.toLocaleString('zh-TW')}</span>
              <span className="text-[13px] text-muted-foreground">件案件</span>
            </div>
          </div>
          <ul className="flex min-w-[200px] flex-1 flex-col gap-2.5">
            {data.map((d, i) => (
              <li key={d.name} className="grid grid-cols-[12px_minmax(0,1fr)_auto_64px] items-center gap-3 text-sm">
                <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="truncate text-foreground" title={d.name}>{d.name}</span>
                <span className="tabular-nums text-muted-foreground">{d.value.toLocaleString('zh-TW')} 件</span>
                <span className="text-right font-medium tabular-nums text-foreground">{((d.value / total) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
