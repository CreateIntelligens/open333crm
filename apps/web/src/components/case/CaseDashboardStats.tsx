'use client';

import React from 'react';
import { useCaseStats } from '@/hooks/useCases';

interface StatCardProps {
  label: string;
  value: number;
  color: string;
  borderColor: string;
}

function StatCard({ label, value, color, borderColor }: StatCardProps) {
  return (
    <div className={`flex-1 rounded-lg border-l-4 bg-card p-4 shadow-sm ${borderColor}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export function CaseDashboardStats() {
  const { stats } = useCaseStats();

  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard
        label="開啟中"
        value={stats.openCount}
        color="text-blue-600"
        borderColor="border-blue-500"
      />
      <StatCard
        label="SLA 違規"
        value={stats.breachedCount}
        color="text-red-600"
        borderColor="border-red-500"
      />
      <StatCard
        label="即將到期"
        value={stats.warningCount}
        color="text-orange-600"
        borderColor="border-orange-500"
      />
      <StatCard
        label="今日解決"
        value={stats.resolvedTodayCount}
        color="text-green-600"
        borderColor="border-green-500"
      />
    </div>
  );
}
