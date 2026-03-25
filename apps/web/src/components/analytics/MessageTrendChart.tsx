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

interface MessageTrendChartProps {
  data: Array<{
    date: string;
    LINE?: number;
    FB?: number;
    WEBCHAT?: number;
    total?: number;
  }>;
  isLoading: boolean;
}

const CHANNEL_COLORS: Record<string, string> = {
  LINE: '#06C755',
  FB: '#1877F2',
  WEBCHAT: '#6B7280',
  total: '#8B5CF6',
};

export function MessageTrendChart({ data, isLoading }: MessageTrendChartProps) {
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
            <LineChart data={data}>
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
                name="LINE"
              />
              <Line
                type="monotone"
                dataKey="FB"
                stroke={CHANNEL_COLORS.FB}
                strokeWidth={2}
                dot={false}
                name="Facebook"
              />
              <Line
                type="monotone"
                dataKey="WEBCHAT"
                stroke={CHANNEL_COLORS.WEBCHAT}
                strokeWidth={2}
                dot={false}
                name="WebChat"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
