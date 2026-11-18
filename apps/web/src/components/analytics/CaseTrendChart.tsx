'use client';

import React, { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CARD, ReportEmpty, ReportError, Skeleton } from './ReportState';

interface CaseTrendChartProps {
  data: Array<{ date: string; opened: number; closed: number }>;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * 案件量趨勢 — 依 Claude Design「案件報表」：每天「新開案」「已解決」兩根並排長條。
 * 已解決另加斜線紋路，除了顏色也能靠紋路區分（色弱友善）；圖例可點擊隱藏／顯示；滑過顯示兩數與差額。
 */
const SERIES = [
  { key: 'opened', label: '新開案', color: '#2876C4', pattern: false },
  { key: 'closed', label: '已解決', color: '#00702E', pattern: true },
] as const;
type Key = (typeof SERIES)[number]['key'];

function Swatch({ color, pattern }: { color: string; pattern: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <defs>
        <pattern id={`sw-${color}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill={color} />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#fff" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="14" height="14" rx="3" fill={pattern ? `url(#sw-${color})` : color} />
    </svg>
  );
}

export function CaseTrendChart({ data, isLoading, error, onRetry }: CaseTrendChartProps) {
  const [hidden, setHidden] = useState<Set<Key>>(new Set());
  const empty = !isLoading && (data.length === 0 || data.every((d) => !d.opened && !d.closed));
  const toggle = (k: Key) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <section aria-labelledby="h-case-trend" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id="h-case-trend" className="text-lg font-semibold text-foreground">案件量趨勢</h2>
          <span className="text-xs text-muted-foreground">單位：件／日</span>
        </div>
        {!isLoading && !error && !empty && (
          <div role="group" aria-label="圖例，點擊可隱藏或顯示" className="flex items-center gap-2">
            {SERIES.map((s) => {
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
                  <Swatch color={s.color} pattern={s.pattern} />
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && data.length === 0 ? (
        <ReportError label="案件量趨勢" onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton className="h-[260px] w-full" />
      ) : empty ? (
        <ReportEmpty className="h-[260px]" />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }} barGap={4}>
            <defs>
              <pattern id="hatch-closed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#00702E" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.55" />
              </pattern>
            </defs>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v) => String(v).slice(5).replace('-', '/')}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--surface-hover))' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as { opened: number; closed: number };
                const diff = row.opened - row.closed;
                return (
                  <div role="tooltip" className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-sm shadow-dropdown">
                    <span className="font-semibold text-foreground">{String(label).replace(/-/g, '/')}</span>
                    {SERIES.map((s) => (
                      <span key={s.key} className="flex items-center gap-2">
                        <Swatch color={s.color} pattern={s.pattern} />
                        <span className="flex-1 text-muted-foreground">{s.label}</span>
                        <span className="tabular-nums text-foreground">{row[s.key].toLocaleString('zh-TW')} 件</span>
                      </span>
                    ))}
                    <span className="mt-1 flex justify-between border-t border-border pt-1.5 text-foreground">
                      <span>差額</span>
                      <span className="tabular-nums font-semibold">{diff > 0 ? `+${diff}` : diff} 件</span>
                    </span>
                  </div>
                );
              }}
            />
            {!hidden.has('opened') && <Bar dataKey="opened" name="新開案" fill="#2876C4" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />}
            {!hidden.has('closed') && <Bar dataKey="closed" name="已解決" fill="url(#hatch-closed)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
