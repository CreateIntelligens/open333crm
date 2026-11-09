'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { channelDisplayName } from '@open333crm/shared';

interface MessageTrendChartProps {
  data: Array<{
    date: string;
    LINE?: number;
    FB?: number;
    THREADS?: number;
    WEBCHAT?: number;
    total?: number;
  }>;
  isLoading: boolean;
}

const CHANNEL_COLORS: Record<string, string> = {
  LINE: '#06C755',
  FB: '#1877F2',
  THREADS: '#E4405F',
  WEBCHAT: '#6B7280',
  total: '#8B5CF6',
};

export function MessageTrendChart({ data, isLoading }: MessageTrendChartProps) {
  // API 只有當天有 Instagram 訊息才回 THREADS，沒有的日子補 0，線才不會斷
  const rows = data.map((d) => ({ ...d, THREADS: d.THREADS ?? 0 }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">訊息趨勢</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            尚無資料
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => String(v).slice(5)}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="LINE"
                stroke={CHANNEL_COLORS.LINE}
                strokeWidth={2}
                dot={false}
                name={channelDisplayName('LINE')}
              />
              <Line
                type="monotone"
                dataKey="FB"
                stroke={CHANNEL_COLORS.FB}
                strokeWidth={2}
                dot={false}
                name={channelDisplayName('FB')}
              />
              <Line
                type="monotone"
                dataKey="WEBCHAT"
                stroke={CHANNEL_COLORS.WEBCHAT}
                strokeWidth={2}
                dot={false}
                name={channelDisplayName('WEBCHAT')}
              />
              <Line
                type="monotone"
                dataKey="THREADS"
                stroke={CHANNEL_COLORS.THREADS}
                strokeWidth={2}
                dot={false}
                name={channelDisplayName('THREADS')}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
