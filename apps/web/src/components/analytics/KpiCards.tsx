'use client';

import React from 'react';
import {
  MessageSquare,
  Briefcase,
  Shield,
  Star,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface OverviewData {
  totalMessages: number;
  openCases: number;
  slaAchievementRate: number | null;
  csatAvg: number | null;
}

interface KpiCardsProps {
  data?: OverviewData;
  isLoading: boolean;
}

interface KpiCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number | null;
  subtitle?: string;
  color: string;
  isLoading: boolean;
}

function KpiCard({ icon, title, value, subtitle, color, isLoading }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${color}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{title}</p>
            {isLoading ? (
              <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-2xl font-bold">{value ?? '-'}</p>
                {subtitle && (
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ data, isLoading }: KpiCardsProps) {
  const cards = [
    {
      icon: <MessageSquare className="h-6 w-6 text-blue-600" />,
      title: '訊息總量',
      value: data?.totalMessages ?? null,
      color: 'bg-blue-100',
    },
    {
      icon: <Briefcase className="h-6 w-6 text-orange-600" />,
      title: '開啟中案件',
      value: data?.openCases ?? null,
      color: 'bg-orange-100',
    },
    {
      icon: <Shield className="h-6 w-6 text-emerald-600" />,
      title: 'SLA 達成率',
      value: data?.slaAchievementRate != null ? `${data.slaAchievementRate}%` : null,
      color: 'bg-emerald-100',
    },
    {
      icon: <Star className="h-6 w-6 text-amber-600" />,
      title: 'CSAT 分數',
      value: data?.csatAvg ?? null,
      subtitle: data?.csatAvg != null ? '/ 5.0' : undefined,
      color: 'bg-amber-100',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <KpiCard key={card.title} {...card} isLoading={isLoading} />
      ))}
    </div>
  );
}
