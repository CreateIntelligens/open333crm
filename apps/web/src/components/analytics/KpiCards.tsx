'use client';

import React from 'react';
import { AlertTriangle, Briefcase, MessageSquare, Shield, Star } from 'lucide-react';
import { ReportError, Skeleton } from './ReportState';

interface OverviewData {
  totalMessages: number;
  openCases: number;
  slaAchievementRate: number | null;
  csatAvg: number | null;
}

interface KpiCardsProps {
  data?: OverviewData;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

const SLA_TARGET = 80;
const num = (n: number) => n.toLocaleString('zh-TW');

/**
 * 關鍵指標 — 依 Claude Design「報表總覽」：4 張卡片，左側淡色圖示、標題、大數字、一行說明。
 * SLA 低於目標時數字改警示色並加上「低於目標」文字（不只靠顏色）。
 */
export function KpiCards({ data, isLoading, error, onRetry }: KpiCardsProps) {
  if (error && !data) return <ReportError label="關鍵指標" onRetry={onRetry} />;

  const empty = !isLoading && data != null && data.totalMessages === 0 && data.openCases === 0 && data.slaAchievementRate == null && data.csatAvg == null;
  const slaLow = data?.slaAchievementRate != null && data.slaAchievementRate < SLA_TARGET;

  const cards = [
    { key: 'msg', icon: MessageSquare, title: '訊息總量', tint: 'bg-primary-subtle text-primary',
      value: data ? num(data.totalMessages) : '—', note: '選定期間內，所有渠道' },
    { key: 'open', icon: Briefcase, title: '開啟中案件', tint: 'bg-surface-hover text-muted-foreground',
      value: data ? num(data.openCases) : '—', note: '目前尚未結案' },
    { key: 'sla', icon: Shield, title: 'SLA 達成率',
      tint: slaLow ? 'bg-orange-50 text-warning' : 'bg-success-subtle text-success',
      value: data?.slaAchievementRate != null ? `${data.slaAchievementRate.toFixed(1)}%` : '—',
      note: `目標 ${SLA_TARGET.toFixed(1)}%，選定期間內`, warn: slaLow },
    { key: 'csat', icon: Star, title: 'CSAT 分數', tint: 'bg-orange-50 text-amber-700',
      value: data?.csatAvg != null ? `${data.csatAvg.toFixed(1)} / 5.0` : '—', note: '顧客滿意度平均' },
  ];

  return (
    <section aria-label="關鍵指標" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ key, icon: Icon, title, tint, value, note, warn }) => (
        <div key={key} className="flex items-start gap-4 rounded-lg border border-border bg-background p-5">
          <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-[10px] ${tint}`} aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm text-muted-foreground">{title}</span>
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-3 w-32" />
              </>
            ) : (
              <>
                <span className={`whitespace-nowrap text-[28px] font-semibold leading-[34px] tabular-nums ${warn ? 'text-warning' : 'text-foreground'}`}>
                  {empty ? '—' : value}
                </span>
                {warn && !empty && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    低於目標
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{empty ? '此期間沒有資料' : note}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
