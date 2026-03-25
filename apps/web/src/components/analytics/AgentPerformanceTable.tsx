'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2, ArrowUpDown } from 'lucide-react';

interface AgentData {
  agentId: string;
  name: string;
  role: string;
  casesHandled: number;
  casesResolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAvg: number | null;
  slaAchievementRate: number | null;
}

interface AgentPerformanceTableProps {
  data: AgentData[];
  isLoading: boolean;
  limit?: number;
  title?: string;
}

type SortKey = 'casesHandled' | 'casesResolved' | 'avgFirstResponseMinutes' | 'csatAvg' | 'slaAchievementRate';

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '-';
  if (minutes < 60) return `${Math.round(minutes)} 分`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} 時 ${m} 分`;
}

export function AgentPerformanceTable({
  data,
  isLoading,
  limit,
  title = '客服績效',
}: AgentPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('casesHandled');
  const [sortDesc, setSortDesc] = useState(true);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey] ?? -1;
    const bv = b[sortKey] ?? -1;
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const display = limit ? sorted.slice(0, limit) : sorted;

  const thClass = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex h-[200px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : display.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            尚無資料
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">客服</th>
                  <th className={thClass} onClick={() => handleSort('casesHandled')}>
                    <span className="flex items-center gap-1">
                      處理案件 <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('casesResolved')}>
                    <span className="flex items-center gap-1">
                      已解決 <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('avgFirstResponseMinutes')}>
                    <span className="flex items-center gap-1">
                      平均首次回應 <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('csatAvg')}>
                    <span className="flex items-center gap-1">
                      CSAT <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className={thClass} onClick={() => handleSort('slaAchievementRate')}>
                    <span className="flex items-center gap-1">
                      SLA 達成 <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {display.map((agent) => (
                  <tr key={agent.agentId} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-medium">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">{agent.role}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">{agent.casesHandled}</td>
                    <td className="px-3 py-2">{agent.casesResolved}</td>
                    <td className="px-3 py-2">{formatMinutes(agent.avgFirstResponseMinutes)}</td>
                    <td className="px-3 py-2">{agent.csatAvg ?? '-'}</td>
                    <td className="px-3 py-2">
                      {agent.slaAchievementRate != null ? `${agent.slaAchievementRate}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
