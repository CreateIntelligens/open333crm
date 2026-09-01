'use client';

/**
 * MaterialStatsPanel — 素材成效面板（素材詳情頁）
 *
 * 顯示素材級成效：使用次數、回覆數、開案數、點擊數、點擊率。
 * 點擊率基於廣播發送（經帶 materialId 的短連結歸因）；無資料顯示「暫無資料」不假造 0。
 * 對齊 material-click-attribution 差異化定位「證明哪則訊息有效」。
 */

import React from 'react';
import { BarChart3 } from 'lucide-react';
import { useMaterialStats } from '@/hooks/useMaterials';

interface Props {
  materialId: string;
}

export function MaterialStatsPanel({ materialId }: Props) {
  const { stats, isLoading } = useMaterialStats(materialId);

  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? '暫無資料' : n.toLocaleString();
  const fmtRate = (n: number | null | undefined) =>
    n === null || n === undefined ? '暫無資料' : `${n}%`;

  const items: { label: string; value: string; hint?: string }[] = [
    { label: '使用次數', value: fmt(stats?.usageCount) },
    { label: '點擊數', value: fmt(stats?.clickCount) },
    { label: '點擊率', value: fmtRate(stats?.clickThroughRate), hint: '基於廣播發送' },
    { label: '回覆數', value: fmt(stats?.replyCount) },
    { label: '開案數', value: fmt(stats?.casesOpened) },
  ];

  return (
    <div className="rounded-lg border border-border bg-white p-4 dark:bg-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />素材成效
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">載入中…</p>
      ) : (
        <dl className="grid grid-cols-2 gap-2">
          {items.map((it) => {
            const isEmpty = it.value === '暫無資料';
            return (
              <div key={it.label} className="rounded-md border border-border/60 bg-muted/40 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted-foreground">
                  {it.label}
                  {it.hint && <span className="ml-1 text-[10px] text-muted-foreground/70">· {it.hint}</span>}
                </dt>
                <dd
                  className={`mt-0.5 tabular-nums ${
                    isEmpty ? 'text-xs font-medium text-muted-foreground/70' : 'text-lg font-bold text-foreground'
                  }`}
                >
                  {it.value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <p className="mt-2.5 text-[11px] text-muted-foreground/70">
        點擊率＝點擊數 ÷ 使用次數；需素材帶連結並經廣播發送才有點擊歸因資料。
      </p>
    </div>
  );
}
