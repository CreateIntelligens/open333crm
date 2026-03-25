'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface ChannelData {
  messagesByChannel: Array<{ name: string; value: number }>;
  conversationsByChannel: Array<{ name: string; value: number }>;
  botVsHuman: Array<{ name: string; value: number }>;
}

interface ChannelDistributionChartProps {
  data?: ChannelData;
  isLoading: boolean;
}

const CHANNEL_COLORS: Record<string, string> = {
  LINE: '#06C755',
  FB: '#1877F2',
  WEBCHAT: '#6B7280',
  WHATSAPP: '#25D366',
};

const BOT_HUMAN_COLORS = ['#8B5CF6', '#F97316'];

export function ChannelDistributionChart({ data, isLoading }: ChannelDistributionChartProps) {
  if (isLoading) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        尚無資料
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Messages by channel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">渠道訊息分布</CardTitle>
        </CardHeader>
        <CardContent>
          {data.messagesByChannel.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">尚無資料</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.messagesByChannel}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  nameKey="name"
                  label={(props: any) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {data.messagesByChannel.map((entry) => (
                    <Cell key={entry.name} fill={CHANNEL_COLORS[entry.name] || '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Bot vs Human */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Bot vs 人工</CardTitle>
        </CardHeader>
        <CardContent>
          {data.botVsHuman.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">尚無資料</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.botVsHuman}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  nameKey="name"
                  label={(props: any) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {data.botVsHuman.map((_, i) => (
                    <Cell key={i} fill={BOT_HUMAN_COLORS[i % BOT_HUMAN_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Conversations by channel bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">各渠道對話數</CardTitle>
        </CardHeader>
        <CardContent>
          {data.conversationsByChannel.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">尚無資料</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.conversationsByChannel}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" name="對話數">
                  {data.conversationsByChannel.map((entry) => (
                    <Cell key={entry.name} fill={CHANNEL_COLORS[entry.name] || '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
