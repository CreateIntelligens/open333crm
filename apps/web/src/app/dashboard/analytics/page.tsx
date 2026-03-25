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
      // silent
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Topbar title="數據報表">
        <DateRangePicker from={from} to={to} onChange={handleDateChange} />
        <button
          onClick={handleExport}
          disabled={exporting}
          className="ml-2 flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          匯出 CSV
        </button>
      </Topbar>

      <div className="flex-1 overflow-auto p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">概覽</TabsTrigger>
            <TabsTrigger value="cases">案件報表</TabsTrigger>
            <TabsTrigger value="agents">客服績效</TabsTrigger>
            <TabsTrigger value="channels">渠道分析</TabsTrigger>
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
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">聯繫人</th>
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
        </Tabs>
      </div>
    </div>
  );
}
