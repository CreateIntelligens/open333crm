'use client';

import React, { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Symbols,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { channelDisplayName } from '@open333crm/shared';
import { CARD, ReportEmpty, ReportError, Skeleton } from './ReportState';

interface MessageTrendChartProps {
  // Instagram 私訊在 API 的鍵是 THREADS（取自 main；原本的 IG 鍵永遠沒有資料）
  data: Array<{ date: string; LINE?: number; FB?: number; THREADS?: number; WEBCHAT?: number; total?: number }>;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * 訊息趨勢 — 依 Claude Design「報表總覽」：
 * 每個渠道除了顏色，再用線型＋點形狀區分（色弱也分得出來），圖例在上方、可點擊隱藏／顯示，
 * 滑過顯示當日各渠道數量與合計。改用直線連接，避免平滑曲線畫出「低於 0」的誤導弧線。
 */
const SERIES = [
  { key: 'FB', label: channelDisplayName('FB'), color: '#2876C4', dash: undefined, shape: 'circle' },
  { key: 'THREADS', label: channelDisplayName('THREADS'), color: '#D9480F', dash: '7 4', shape: 'square' },
  { key: 'LINE', label: channelDisplayName('LINE'), color: '#0F766E', dash: undefined, shape: 'triangle' },
  { key: 'WEBCHAT', label: channelDisplayName('WEBCHAT'), color: '#475569', dash: '2 4', shape: 'diamond' },
] as const;
type SeriesKey = (typeof SERIES)[number]['key'];

function LegendMark({ color, dash, shape }: { color: string; dash?: string; shape: string }) {
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true">
      <line x1="1" y1="6" x2="27" y2="6" stroke={color} strokeWidth="2" strokeDasharray={dash} />
      <Symbols cx={14} cy={6} type={shape as 'circle'} size={36} fill={color} />
    </svg>
  );
}

export function MessageTrendChart({ data, isLoading, error, onRetry }: MessageTrendChartProps) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  // 只顯示資料裡實際有的渠道（目前沒有串 Instagram 的租戶就不會出現）
  const present = SERIES.filter((s) => data.some((d) => d[s.key] != null));
  // API 只有當天有該渠道訊息才回傳那個鍵，沒有的日子補 0，線才不會斷（取自 main）
  const rows = data.map((d) => {
    const row = { ...d };
    for (const s of present) row[s.key] = d[s.key] ?? 0;
    return row;
  });
  const empty = !isLoading && (data.length === 0 || data.every((d) => present.every((s) => !d[s.key])));
  const toggle = (k: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  return (
    <section aria-labelledby="h-trend" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id="h-trend" className="text-lg font-semibold text-foreground">訊息趨勢</h2>
          <span className="text-xs text-muted-foreground">單位：則／日</span>
        </div>
        {!isLoading && !error && !empty && (
          <div role="group" aria-label="渠道圖例，點擊可隱藏或顯示" className="flex flex-wrap items-center gap-2">
            {present.map((s) => {
              const on = !hidden.has(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s.key)}
                  className={`flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    on ? 'border-border bg-background text-foreground' : 'border-transparent bg-muted text-muted-foreground line-through'
                  }`}
                >
                  <LegendMark color={s.color} dash={s.dash} shape={s.shape} />
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && data.length === 0 ? (
        <ReportError label="訊息趨勢" onRetry={onRetry} />
      ) : isLoading ? (
        <div aria-busy="true" aria-label="載入中" className="flex h-[280px] flex-col justify-end gap-3">
          <Skeleton className="h-full w-full" />
        </div>
      ) : empty ? (
        <ReportEmpty className="h-[280px]" />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v) => String(v).slice(5).replace('-', '/')}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v) => Number(v).toLocaleString('zh-TW')}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
                return (
                  <div role="tooltip" className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-sm shadow-dropdown">
                    <span className="font-semibold text-foreground">{String(label).replace(/-/g, '/')}</span>
                    {payload.map((p) => {
                      const s = SERIES.find((x) => x.key === p.dataKey);
                      return (
                        <span key={String(p.dataKey)} className="flex items-center gap-2">
                          {s && <LegendMark color={s.color} dash={s.dash} shape={s.shape} />}
                          <span className="flex-1 text-muted-foreground">{s?.label ?? p.name}</span>
                          <span className="tabular-nums text-foreground">{Number(p.value).toLocaleString('zh-TW')}</span>
                        </span>
                      );
                    })}
                    <span className="mt-1 flex justify-between border-t border-border pt-1.5 font-semibold text-foreground">
                      <span>合計</span>
                      <span className="tabular-nums">{total.toLocaleString('zh-TW')}</span>
                    </span>
                  </div>
                );
              }}
            />
            {present.filter((s) => !hidden.has(s.key)).map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; index?: number }) => (
                  <Symbols key={`${s.key}-${props.index}`} cx={props.cx} cy={props.cy} type={s.shape as 'circle'} size={30} fill={s.color} />
                )}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
