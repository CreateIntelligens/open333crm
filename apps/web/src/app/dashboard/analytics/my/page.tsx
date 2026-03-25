'use client';

import React from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useMyPerformance } from '@/hooks/useAnalytics';

interface MetricCardProps {
  label: string;
  value: string | number | null;
  target?: number;
  unit?: string;
  higherIsBetter?: boolean;
  isLoading: boolean;
}

function MetricCard({ label, value, target, unit = '', higherIsBetter = true, isLoading }: MetricCardProps) {
  let status: 'ok' | 'warning' | 'na' = 'na';
  if (target != null && value != null) {
    const numVal = typeof value === 'string' ? parseFloat(value) : value;
    if (higherIsBetter) {
      status = numVal >= target ? 'ok' : 'warning';
    } else {
      status = numVal <= target ? 'ok' : 'warning';
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        {isLoading ? (
          <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-2xl font-bold">
              {value ?? '-'}{unit}
            </p>
            {status === 'ok' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            {status === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
          </div>
        )}
        {target != null && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            目標: {target}{unit}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '-';
  if (minutes < 60) return `${Math.round(minutes)} 分`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} 時 ${m} 分`;
}

export default function MyPerformancePage() {
  const { data, isLoading } = useMyPerformance();

  return (
    <div className="flex h-full flex-col">
      <Topbar title="我的績效" />
      <div className="flex-1 overflow-auto p-6">
        {/* Alert cards */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="flex items-center gap-4 p-5">
              <Clock className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-sm font-medium text-orange-700">待處理案件</p>
                {isLoading ? (
                  <Loader2 className="mt-1 h-5 w-5 animate-spin text-orange-400" />
                ) : (
                  <p className="text-2xl font-bold text-orange-800">{data?.pendingCases ?? 0}</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="flex items-center gap-4 p-5">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-700">SLA 即將到期</p>
                {isLoading ? (
                  <Loader2 className="mt-1 h-5 w-5 animate-spin text-red-400" />
                ) : (
                  <p className="text-2xl font-bold text-red-800">{data?.slaSoonExpiring ?? 0}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Performance metrics */}
        <h2 className="mb-4 text-base font-semibold">本月績效</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="處理案件數"
            value={data?.casesHandled ?? null}
            isLoading={isLoading}
          />
          <MetricCard
            label="已解決案件"
            value={data?.casesResolved ?? null}
            isLoading={isLoading}
          />
          <MetricCard
            label="平均首次回應"
            value={data?.avgFirstResponseMinutes != null ? formatMinutes(data.avgFirstResponseMinutes) : null}
            target={15}
            unit=""
            higherIsBetter={false}
            isLoading={isLoading}
          />
          <MetricCard
            label="平均解決時間"
            value={data?.avgResolutionMinutes != null ? formatMinutes(data.avgResolutionMinutes) : null}
            isLoading={isLoading}
          />
          <MetricCard
            label="CSAT 分數"
            value={data?.csatAvg ?? null}
            target={4.0}
            unit=" / 5"
            higherIsBetter={true}
            isLoading={isLoading}
          />
          <MetricCard
            label="SLA 達成率"
            value={data?.slaAchievementRate ?? null}
            target={90}
            unit="%"
            higherIsBetter={true}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
