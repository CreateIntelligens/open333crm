'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Hourglass, Inbox, Smile, Timer, TrendingUp, Trophy } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { useMyPerformance } from '@/hooks/useAnalytics';
import { CARD, ReportError, Skeleton } from '@/components/analytics/ReportState';
import { useAuth } from '@/providers/AuthProvider';

/**
 * 我的績效 — 版面依 Claude Design：待處理提醒 → 本月績效（處理量＋目標指標）→ 本月摘要。
 * 設計稿有「與上個月同期比較」與「團隊」，後端 /analytics/my 目前沒有提供，先不顯示（不放假資料）。
 * 目標值沿用原頁面的設定：首次回應 ≤ 15 分、CSAT ≥ 4.0、SLA ≥ 90%（平均解決時間原本就沒有目標）。
 */

const TARGETS = { frt: 15, csat: 4.0, sla: 90 } as const;
const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', SUPERVISOR: '客服主管', AGENT: '客服' };

function formatMinutes(min: number | null | undefined) {
  if (min == null) return null;
  if (min < 60) return { value: min.toFixed(1), unit: '分' };
  return { value: `${Math.floor(min / 60)} 時 ${Math.round(min % 60)}`, unit: '分' };
}

const pad = (n: number) => String(n).padStart(2, '0');
function monthPeriod() {
  const now = new Date();
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/01 – ${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
}

interface TargetCardProps {
  label: string;
  icon: React.ElementType;
  value: string | null;
  unit?: string;
  /** 有目標才顯示達標狀態與進度條 */
  target?: { text: string; achieve: number; ok: boolean };
  loading: boolean;
}

function TargetCard({ label, icon: Icon, value, unit, target, loading }: TargetCardProps) {
  const miss = target && !target.ok;
  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${miss ? 'border-red-200 bg-destructive-subtle/40' : 'border-border bg-background'}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] ${miss ? 'bg-destructive-subtle text-destructive' : 'bg-primary-subtle text-primary'}`} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm text-muted-foreground">{label}</span>
        {target && !loading && value != null && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${target.ok ? 'bg-success-subtle text-success' : 'bg-destructive-subtle text-destructive'}`}>
            {target.ok ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
            {target.ok ? '已達標' : '未達標'}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-[28px] font-semibold leading-9 tabular-nums text-foreground">{value ?? '—'}</span>
          {value != null && unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </span>
      )}
      {target && !loading && value != null && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label}達成率`} aria-valuenow={Math.round(target.achieve)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${target.ok ? 'bg-primary' : 'bg-destructive'}`} style={{ width: `${Math.min(100, target.achieve)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>目標 {target.text}</span>
            <span>達成率 {Math.round(target.achieve)}%</span>
          </div>
        </div>
      )}
      {!target && !loading && <span className="text-xs text-muted-foreground">本月平均</span>}
    </div>
  );
}

export default function MyPerformancePage() {
  const { data, isLoading, error, mutate } = useMyPerformance();
  const { agent } = useAuth();

  const pending = data?.pendingCases ?? 0;
  const dueSoon = data?.slaSoonExpiring ?? 0;
  const totalAlerts = pending + dueSoon;
  const handled = data?.casesHandled ?? 0;
  const resolved = data?.casesResolved ?? 0;
  const resolveRate = handled ? Math.round((resolved / handled) * 100) : null;

  const frt = formatMinutes(data?.avgFirstResponseMinutes);
  const resolution = formatMinutes(data?.avgResolutionMinutes);
  const csat: number | null = data?.csatAvg ?? null;
  const sla: number | null = data?.slaAchievementRate ?? null;

  const frtTarget = data?.avgFirstResponseMinutes != null
    ? { text: `≤ ${TARGETS.frt} 分`, ok: data.avgFirstResponseMinutes <= TARGETS.frt, achieve: data.avgFirstResponseMinutes ? Math.min(100, (TARGETS.frt / data.avgFirstResponseMinutes) * 100) : 100 }
    : undefined;
  const csatTarget = csat != null ? { text: `≥ ${TARGETS.csat.toFixed(1)} 分`, ok: csat >= TARGETS.csat, achieve: (csat / TARGETS.csat) * 100 } : undefined;
  const slaTarget = sla != null ? { text: `≥ ${TARGETS.sla}%`, ok: sla >= TARGETS.sla, achieve: (sla / TARGETS.sla) * 100 } : undefined;

  // 本月摘要：只用實際資料組成的事實句，不推測原因
  const notes: Array<{ text: string; tone: 'ok' | 'warn' | 'info' }> = [];
  if (!isLoading && data) {
    const targets = [frtTarget, csatTarget, slaTarget].filter(Boolean) as Array<{ ok: boolean }>;
    const hit = targets.filter((t) => t.ok).length;
    if (targets.length) notes.push({ text: `目標指標 ${targets.length} 項中有 ${hit} 項達標`, tone: hit === targets.length ? 'ok' : 'warn' });
    if (resolveRate != null) notes.push({ text: `本月處理 ${handled.toLocaleString('zh-TW')} 件，已解決 ${resolved.toLocaleString('zh-TW')} 件（解決率 ${resolveRate}%）`, tone: 'info' });
    notes.push(dueSoon
      ? { text: `目前有 ${dueSoon} 件 SLA 即將到期，建議先處理再接新案件`, tone: 'warn' }
      : { text: '目前沒有即將到期的 SLA 案件', tone: 'ok' });
  }

  const subtitle = [data?.name || agent?.name, data?.role ? ROLE_LABEL[data.role] ?? data.role : null, `統計期間 ${monthPeriod()}`]
    .filter(Boolean).join(' · ');

  return (
    <div className="flex h-full flex-col">
      <Topbar title="我的績效" description={subtitle} />
      <div className="flex flex-1 flex-col gap-5 overflow-auto px-7 pb-7">
        {error && !data && <ReportError label="我的績效" onRetry={() => mutate()} />}

        {/* 待處理提醒 */}
        <section aria-labelledby="h-alerts" className={CARD}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="h-alerts" className="text-lg font-semibold text-foreground">待處理提醒</h2>
            {!isLoading && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${dueSoon ? 'bg-destructive-subtle text-destructive' : totalAlerts ? 'bg-orange-50 text-amber-800' : 'bg-success-subtle text-success'}`}>
                {totalAlerts ? `共 ${totalAlerts} 件需要你處理` : '目前沒有待處理事項'}
              </span>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { key: 'pending', label: '待處理案件', icon: Inbox, value: pending, note: '指派給你、尚未結案的案件', tone: pending ? 'warn' : 'ok' },
              { key: 'due', label: 'SLA 即將到期', icon: Clock, value: dueSoon, note: '30 分鐘內到期，請優先處理', tone: dueSoon ? 'danger' : 'ok', badge: dueSoon ? '緊急' : undefined },
            ].map((a) => {
              const tone = a.tone === 'danger'
                ? { box: 'border-red-200 bg-destructive-subtle/40', icon: 'bg-destructive-subtle text-destructive', value: 'text-destructive' }
                : a.tone === 'warn'
                  ? { box: 'border-orange-200 bg-orange-50/60', icon: 'bg-orange-100 text-amber-800', value: 'text-amber-800' }
                  : { box: 'border-border bg-background', icon: 'bg-success-subtle text-success', value: 'text-foreground' };
              return (
                <div key={a.key} className={`flex flex-col gap-3 rounded-xl border p-4 ${tone.box}`}>
                  <div className="flex items-start gap-3">
                    <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-[11px] ${tone.icon}`} aria-hidden="true">
                      <a.icon className="h-5 w-5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {a.label}
                        {a.badge && <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-white">{a.badge}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{a.note}</span>
                    </div>
                    {isLoading ? <Skeleton className="h-9 w-12" /> : (
                      <span className="flex items-baseline gap-1">
                        <span className={`font-mono text-[30px] font-semibold leading-9 tabular-nums ${tone.value}`}>{a.value}</span>
                        <span className="text-sm text-muted-foreground">件</span>
                      </span>
                    )}
                  </div>
                  {!isLoading && a.value > 0 && (
                    <Link
                      href="/dashboard/cases"
                      className="inline-flex h-8 items-center self-start rounded-md border border-input bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      前往處理
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 本月績效 */}
        <section aria-labelledby="h-month" className={CARD}>
          <div className="flex flex-col gap-1">
            <h2 id="h-month" className="text-lg font-semibold text-foreground">本月績效</h2>
            <p className="text-xs text-muted-foreground">統計本月 1 日至今；目標為個人月度標準</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { label: '處理案件數', icon: TrendingUp, value: handled, note: '本月指派並處理的案件' },
              { label: '已解決案件數', icon: Trophy, value: resolved, note: resolveRate != null ? `解決率 ${resolveRate}%` : '—' },
            ].map((v) => (
              <div key={v.label} className="flex items-center gap-3 rounded-xl border border-border bg-background p-4">
                <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-primary-subtle text-primary" aria-hidden="true">
                  <v.icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-sm text-muted-foreground">{v.label}</span>
                {isLoading ? <Skeleton className="h-8 w-20" /> : (
                  <span className="flex flex-col items-end">
                    <span className="flex items-baseline gap-1">
                      <span className="font-mono text-[28px] font-semibold leading-8 tabular-nums text-foreground">{v.value.toLocaleString('zh-TW')}</span>
                      <span className="text-sm text-muted-foreground">件</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{v.note}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <TargetCard label="平均首次回應" icon={Timer} value={frt?.value ?? null} unit={frt?.unit} target={frtTarget} loading={isLoading} />
            <TargetCard label="平均解決時間" icon={Hourglass} value={resolution?.value ?? null} unit={resolution?.unit} loading={isLoading} />
            <TargetCard label="CSAT 分數" icon={Smile} value={csat != null ? csat.toFixed(1) : null} unit="/ 5.0" target={csatTarget} loading={isLoading} />
            <TargetCard label="SLA 達成率" icon={CheckCircle2} value={sla != null ? sla.toFixed(1) : null} unit="%" target={slaTarget} loading={isLoading} />
          </div>
        </section>

        {/* 本月摘要 */}
        {notes.length > 0 && (
          <section aria-labelledby="h-notes" className={CARD}>
            <h2 id="h-notes" className="text-lg font-semibold text-foreground">本月摘要</h2>
            <ul className="flex flex-col gap-2.5">
              {notes.map((n) => (
                <li key={n.text} className="flex items-start gap-2.5 text-sm text-foreground">
                  <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${n.tone === 'ok' ? 'bg-success' : n.tone === 'warn' ? 'bg-warning' : 'bg-primary'}`} />
                  {n.text}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
