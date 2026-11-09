'use client';

import React, { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/providers/AuthProvider';
import { Topbar } from '@/components/layout/Topbar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/analytics/DateRangePicker';
import { KpiCards } from '@/components/analytics/KpiCards';
import { MessageTrendChart } from '@/components/analytics/MessageTrendChart';
import { CaseCategoryPieChart } from '@/components/analytics/CaseCategoryPieChart';
import { CaseTrendChart } from '@/components/analytics/CaseTrendChart';
import { CaseSummary, SlaViolationTable, toPriorityDistribution, PRIORITY_COLORS } from '@/components/analytics/CaseReportParts';
import { AgentPerformanceTable } from '@/components/analytics/AgentPerformanceTable';
import { ChannelDistributionChart } from '@/components/analytics/ChannelDistributionChart';
import {
  useOverviewStats,
  useMessageTrend,
  useCaseAnalytics,
  useAgentPerformance,
  useChannelAnalytics,
} from '@/hooks/useAnalytics';
import api from '@/lib/api';

export default function AnalyticsPage() {
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [to, setTo] = useState(() => new Date());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 後端 POST /analytics/export 需要 analytics.export：沒有權限就不顯示按鈕（權限仍由後端把關）
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
    } catch {
      // 原本失敗時什麼都不顯示，使用者不知道沒有匯出成功
      setExportError('匯出失敗，請稍後再試');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 版面依 Claude Design「報表總覽」：標題列右側為日期範圍＋匯出，下方底線分頁；概覽為 KPI → 趨勢 → 分類／TOP 5 */}
      <Topbar title="總覽" description="檢視訊息量、案件、客服績效與 SLA 達成狀況">
        <DateRangePicker from={from} to={to} onChange={handleDateChange} />
        {canExport && (
          <Button variant="outline" size="lg" onClick={handleExport} disabled={exporting} loading={exporting}>
            {!exporting && <Download />}
            {exporting ? '匯出中…' : '匯出 CSV'}
          </Button>
        )}
      </Topbar>

      <div className="flex-1 overflow-auto px-7 pb-7">
        {exportError && (
          <p role="alert" className="mb-4 rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{exportError}</p>
        )}
        <Tabs value={tab} onValueChange={setTab} variant="underline">
          <TabsList>
            <TabsTrigger value="overview">概覽</TabsTrigger>
            <TabsTrigger value="cases">案件報表</TabsTrigger>
            <TabsTrigger value="agents">客服績效</TabsTrigger>
            <TabsTrigger value="channels">渠道分析</TabsTrigger>
          </TabsList>

          {/* Tab 1: Overview */}
          <TabsContent value="overview" className="mt-5">
            <div className="flex flex-col gap-5">
              <KpiCards data={overview.data} isLoading={overview.isLoading} error={overview.error} onRetry={() => overview.mutate()} />
              <MessageTrendChart data={trend.data} isLoading={trend.isLoading} error={trend.error} onRetry={() => trend.mutate()} />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <CaseCategoryPieChart
                  data={caseData.data?.categoryDistribution || []}
                  isLoading={caseData.isLoading}
                  error={caseData.error}
                  onRetry={() => caseData.mutate()}
                />
                <AgentPerformanceTable
                  data={agents.data}
                  isLoading={agents.isLoading}
                  error={agents.error}
                  onRetry={() => agents.mutate()}
                  limit={5}
                  title="客服績效 TOP 5"
                  onViewAll={() => setTab('agents')}
                />
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: Cases — 依 Claude Design「案件報表」：摘要數字 → 趨勢 → 分類／優先級分布 → SLA 違規清單 */}
          <TabsContent value="cases" className="mt-5">
            <div className="flex flex-col gap-5">
              <CaseSummary
                trend={caseData.data?.trend || []}
                violations={(caseData.data?.slaViolations || []).length}
                isLoading={caseData.isLoading}
              />
              <CaseTrendChart
                data={caseData.data?.trend || []}
                isLoading={caseData.isLoading}
                error={caseData.error}
                onRetry={() => caseData.mutate()}
              />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <CaseCategoryPieChart
                  data={caseData.data?.categoryDistribution || []}
                  isLoading={caseData.isLoading}
                  error={caseData.error}
                  onRetry={() => caseData.mutate()}
                  title="案件分類分布"
                />
                <CaseCategoryPieChart
                  data={toPriorityDistribution(caseData.data?.priorityDistribution || [])}
                  isLoading={caseData.isLoading}
                  error={caseData.error}
                  onRetry={() => caseData.mutate()}
                  title="案件優先級分布"
                  colors={PRIORITY_COLORS}
                />
              </div>
              <SlaViolationTable
                data={caseData.data?.slaViolations || []}
                isLoading={caseData.isLoading}
                error={caseData.error}
                onRetry={() => caseData.mutate()}
              />
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
        </Tabs>
      </div>
    </div>
  );
}
