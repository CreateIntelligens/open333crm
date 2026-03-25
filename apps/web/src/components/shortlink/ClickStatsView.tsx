'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useShortLinks, useClickStats } from '@/hooks/useShortLinks';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export function ClickStatsView() {
  const { links } = useShortLinks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { stats, isLoading } = useClickStats(selectedId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="w-72"
          placeholder="選擇連結"
          options={links.map((l: Record<string, unknown>) => ({
            value: l.id as string,
            label: `${(l.title as string) || (l.slug as string)} (${l.totalClicks as number} clicks)`,
          }))}
        />

        {stats && (
          <div className="flex items-center gap-3">
            <Badge color="#3b82f6">總點擊 {stats.totalClicks}</Badge>
            <Badge color="#8b5cf6">唯一 {stats.uniqueClicks}</Badge>
            <Badge color="#22c55e">識別率 {stats.identificationRate}%</Badge>
          </div>
        )}
      </div>

      {isLoading && selectedId && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {stats && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Daily Click Trend */}
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-4">每日點擊趨勢</h3>
            {stats.timeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={stats.timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(v: string | number) => String(v).slice(5)} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total" name="總點擊" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="unique" name="唯一點擊" stroke="#8b5cf6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                尚無點擊數據
              </div>
            )}
          </div>

          {/* Source Distribution */}
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-4">來源分布</h3>
            {stats.sources.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.sources} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis
                    type="category"
                    dataKey="source"
                    width={120}
                    tickFormatter={(v: string | number) => {
                      const s = String(v);
                      return s.length > 20 ? s.slice(0, 20) + '...' : s;
                    }}
                  />
                  <Tooltip />
                  <Bar dataKey="count" name="點擊次數" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                尚無來源數據
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
