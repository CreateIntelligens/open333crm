'use client';

import React, { useState, useEffect } from 'react';
import { getSlaState } from '@open333crm/shared';
import { cn } from '@/lib/utils';

/**
 * @description 把距離 SLA 期限的毫秒數轉成中文。逾期很久時只顯示天與小時，
 * 避免「-2202h 32m 11s」這種難讀的字串（S04）。
 * @param remainingMs 期限減現在的毫秒數，負數代表已逾期
 * @returns 例如「剩 12 分 30 秒」「逾期 91 天 18 小時」
 */
export function formatSlaRemaining(remainingMs: number): string {
  const prefix = remainingMs <= 0 ? '逾期' : '剩';
  const abs = Math.abs(remainingMs);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);

  if (days > 0) return `${prefix} ${days} 天 ${hours} 小時`;
  if (hours > 0) return `${prefix} ${hours} 小時 ${minutes} 分`;
  return `${prefix} ${minutes} 分 ${seconds} 秒`;
}

interface SlaCountdownProps {
  deadline: string | Date | null;
  className?: string;
}

export function SlaCountdown({ deadline, className }: SlaCountdownProps) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!deadline) return;

    const target = new Date(deadline).getTime();

    function update() {
      const now = Date.now();
      setRemaining(target - now);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline) {
    return <span className={cn('text-sm text-muted-foreground', className)}>無 SLA</span>;
  }

  const state = getSlaState(new Date(deadline), 120);

  let colorClass = 'text-success';
  if (state === 'breached') {
    colorClass = 'text-destructive font-bold';
  } else if (state === 'warning') {
    colorClass = 'text-warning font-semibold';
  }

  const timeStr = formatSlaRemaining(remaining);

  return (
    <span className={cn('text-sm tabular-nums', colorClass, className)}>
      {timeStr}
    </span>
  );
}
