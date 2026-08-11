'use client';

import React, { useState, useEffect } from 'react';
import { getSlaState } from '@open333crm/shared';
import { cn } from '@/lib/utils';

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

  const isExpired = remaining <= 0;
  const hours = Math.floor(Math.abs(remaining) / (1000 * 60 * 60));
  const minutes = Math.floor((Math.abs(remaining) % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((Math.abs(remaining) % (1000 * 60)) / 1000);

  const state = getSlaState(new Date(deadline), 120);

  let colorClass = 'text-success';
  if (state === 'breached') {
    colorClass = 'text-destructive font-bold';
  } else if (state === 'warning') {
    colorClass = 'text-warning font-semibold';
  }

  const timeStr = `${isExpired ? '-' : ''}${hours}h ${minutes}m ${seconds}s`;

  return (
    <span className={cn('text-sm tabular-nums', colorClass, className)}>
      {timeStr}
    </span>
  );
}
