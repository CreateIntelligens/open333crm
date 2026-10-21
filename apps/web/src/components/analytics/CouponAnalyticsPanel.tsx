'use client';

/**
 * 數據報表的「優惠券成效」分頁（add-coupon-system 12.16）：期間內發出的券的成效、每日發放與核銷趨勢、券排行。
 * 核銷率＝已核銷 ÷ 已領取（與單張券的成效頁相同口徑）。
 */
import React from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface CouponAnalyticsData {
  totals: { issued: number; claimed: number; redeemed: number; redeemRate: number | null };
  trend: { date: string; issued: number; redeemed: number }[];
  topCoupons: { couponId: string; name: string; issued: number; claimed: number; redeemed: number; redeemRate: number | null }[];
}

interface Props {
  data?: CouponAnalyticsData;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const fmt = (n: number) => n.toLocaleString('zh-TW');
const pct = (n: number | null) => (n == null ? '—' : `${n}%`);

/** 兩條線的顏色（類別色第 1、2 槽，深色模式各自調整後通過色盲與對比檢查） */
const SERIES_CLASS = '[--series-issued:#2a78d6] [--series-redeemed:#eb6834] dark:[--series-issued:#3987e5] dark:[--series-redeemed:#d95926]';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card data-kpi>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function CouponAnalyticsPanel({ data, isLoading, error, onRetry }: Props) {
  if (isLoading && !data) {
    return (
      <div role="status" aria-label="載入中" className="flex h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
        <span>無法載入優惠券成效，請稍後重試</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          重試
        </Button>
      </div>
    );
  }

  const { totals, trend, topCoupons } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="發出" value={fmt(totals.issued)} hint="期間內發出的張數" />
        <Kpi label="已領取" value={fmt(totals.claimed)} />
        <Kpi label="已核銷" value={fmt(totals.redeemed)} />
        <Kpi label="核銷率" value={pct(totals.redeemRate)} hint="已核銷 ÷ 已領取" />
      </div>

      {totals.issued === 0 && trend.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">這段期間沒有發出優惠券</CardContent>
        </Card>
      ) : (
        <>
          <Card className={SERIES_CLASS}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">每日發放與核銷</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="issued" name="發出" stroke="var(--series-issued)" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="redeemed" name="核銷" stroke="var(--series-redeemed)" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">以表格檢視</summary>
                <table aria-label="每日發放與核銷" className="mt-2 w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 text-left font-medium">日期</th>
                      <th className="py-1.5 text-right font-medium">發出</th>
                      <th className="py-1.5 text-right font-medium">核銷</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {trend.map((t) => (
                      <tr key={t.date}>
                        <td className="py-1.5">{t.date}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(t.issued)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(t.redeemed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">券排行（依核銷數，前 10 名）</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table aria-label="券排行" className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left font-medium">券名</th>
                    <th className="py-2 text-right font-medium">發出</th>
                    <th className="py-2 text-right font-medium">已領取</th>
                    <th className="py-2 text-right font-medium">已核銷</th>
                    <th className="py-2 text-right font-medium">核銷率</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {topCoupons.map((c) => (
                    <tr key={c.couponId}>
                      <td className="py-2">
                        <Link href={`/dashboard/marketing/coupons/${c.couponId}`} className="font-medium text-primary hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-2 text-right tabular-nums">{fmt(c.issued)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(c.claimed)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(c.redeemed)}</td>
                      <td className="py-2 text-right tabular-nums">{pct(c.redeemRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
