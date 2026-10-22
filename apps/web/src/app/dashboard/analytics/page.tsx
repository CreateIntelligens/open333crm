'use client';

import React, { useState, useCallback } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/analytics/DateRangePicker';
import { KpiCards } from '@/components/analytics/KpiCards';
import { MessageTrendChart } from '@/components/analytics/MessageTrendChart';
import { CaseCategoryPieChart } from '@/components/analytics/CaseCategoryPieChart';
import { CaseTrendChart } from '@/components/analytics/CaseTrendChart';
import { AgentPerformanceTable } from '@/components/analytics/AgentPerformanceTable';
import { ChannelDistributionChart } from '@/components/analytics/ChannelDistributionChart';
import { CouponAnalyticsPanel } from '@/components/analytics/CouponAnalyticsPanel';
import {
  useOverviewStats,
  useMessageTrend,
  useCaseAnalytics,
  useAgentPerformance,
  useChannelAnalytics,
  useCouponAnalytics,
} from '@/hooks/useAnalytics';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { usePermission } from '@/providers/AuthProvider';

/**
 * 匯出用 responseType: 'blob'，錯誤回應的內容也是 Blob，要先轉回 JSON 才讀得到後端的訊息。
 */
async function exportErrorMessage(err: unknown): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: { message?: string } };
      if (parsed?.error?.message) return parsed.error.message;
    } catch {
      /* 不是 JSON，退回依狀態碼說明 */
    }
  }
  return getApiErrorMessage(err, '請稍後重試');
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [to, setTo] = useState(() => new Date());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 後端 POST /analytics/export 要 analytics.export（G12）
  const canExport = usePermission('analytics.export');

  const handleDateChange = useCallback((f: Date, t: Date) => {
    setFrom(f);
    setTo(t);
  }, []);

  // Data hooks
  const overview = useOverviewStats(from, to);
  const trend = useMessageTrend(from, to);
  const caseData = useCaseAnalytics(from, to);
  const agents = useAgentPerformance(from, to);
  const channels = useChannelAnalytics(from, to);
  // 切到該分頁才載入
  const coupons = useCouponAnalytics(from, to, tab === 'coupons');

  // CSV export
  async function handleExport() {
    const typeMap: Record<string, string> = {
      overview: 'overview',
      cases: 'cases',
      agents: 'agents',
      channels: 'channels',
    };
    const reportType = typeMap[tab] || 'overview';
    setExporting(true);
    setExportError(null);
    try {
      const res = await api.post(
        '/analytics/export',
        { reportType, from: from.toISOString(), to: to.toISOString() },
        { responseType: 'blob' },
      );
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}_report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(`匯出失敗：${await exportErrorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Topbar title="數據報表">
        <DateRangePicker from={from} to={to} onChange={handleDateChange} />
        {/* 優惠券成效沒有對應的匯出；券的名單匯出在各張券的詳情頁 */}
        {canExport && tab !== 'coupons' && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="ml-2 flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            匯出 CSV
          </button>
        )}
      </Topbar>

      {exportError && (
        <div role="alert" className="mx-6 mt-4 rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-2 text-sm text-destructive">
          {exportError}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">概覽</TabsTrigger>
            <TabsTrigger value="cases">案件報表</TabsTrigger>
            <TabsTrigger value="agents">客服績效</TabsTrigger>
            <TabsTrigger value="channels">渠道分析</TabsTrigger>
            <TabsTrigger value="coupons">優惠券成效</TabsTrigger>
          </TabsList>

          {/* Tab 1: Overview */}
          <TabsContent value="overview">
            <div className="space-y-6">
              <KpiCards data={overview.data} isLoading={overview.isLoading} />
              <MessageTrendChart data={trend.data} isLoading={trend.isLoading} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CaseCategoryPieChart
                  data={caseData.data?.categoryDistribution || []}
                  isLoading={caseData.isLoading}
                />
                <AgentPerformanceTable
                  data={agents.data}
                  isLoading={agents.isLoading}
                  limit={5}
                  title="客服績效 TOP 5"
                />
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: Cases */}
          <TabsContent value="cases">
            <div className="space-y-6">
              <CaseTrendChart
                data={caseData.data?.trend || []}
                isLoading={caseData.isLoading}
              />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CaseCategoryPieChart
                  data={caseData.data?.categoryDistribution || []}
                  isLoading={caseData.isLoading}
                  title="案件分類分布"
                />
                <CaseCategoryPieChart
                  data={caseData.data?.priorityDistribution || []}
                  isLoading={caseData.isLoading}
                  title="案件優先級分布"
                />
              </div>

              {/* SLA violations table */}
              <div className="rounded-lg border">
                <div className="border-b bg-muted/50 px-4 py-3">
                  <h3 className="text-sm font-semibold">SLA 違規案件</h3>
                </div>
                {caseData.isLoading ? (
                  <div className="flex h-[100px] items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (caseData.data?.slaViolations || []).length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    無 SLA 違規案件
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">標題</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">狀態</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">指派客服</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">聯絡人</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">SLA 到期</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(caseData.data?.slaViolations || []).map((v: any) => (
                          <tr key={v.id} className="hover:bg-muted/30">
                            <td className="px-4 py-2 font-medium">{v.title}</td>
                            <td className="px-4 py-2">{v.status}</td>
                            <td className="px-4 py-2">{v.assignee?.name || '-'}</td>
                            <td className="px-4 py-2">{v.contact?.displayName || '-'}</td>
                            <td className="px-4 py-2 text-destructive">
                              {v.slaDueAt ? new Date(v.slaDueAt).toLocaleString('zh-TW') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Escalation rate */}
              {caseData.data?.escalationRate != null && (
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">升級率</p>
                  <p className="text-2xl font-bold">{caseData.data.escalationRate}%</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Tab 3: Agents */}
          <TabsContent value="agents">
            <AgentPerformanceTable
              data={agents.data}
              isLoading={agents.isLoading}
              title="全部客服績效"
            />
          </TabsContent>

          {/* Tab 4: Channels */}
          <TabsContent value="channels">
            <ChannelDistributionChart
              data={channels.data}
              isLoading={channels.isLoading}
            />
          </TabsContent>

          {/* Tab 5: Coupons */}
          <TabsContent value="coupons">
            <CouponAnalyticsPanel
              data={coupons.data}
              isLoading={coupons.isLoading}
              error={coupons.error}
              onRetry={() => void coupons.mutate()}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
