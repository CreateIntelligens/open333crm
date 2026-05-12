'use client';

import React, { useState, useEffect } from 'react';
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
    return <span className={cn('text-sm text-ink-subtle', className)}>無 SLA</span>;
  }

  const isExpired = remaining <= 0;
  const hours = Math.floor(Math.abs(remaining) / (1000 * 60 * 60));
  const minutes = Math.floor((Math.abs(remaining) % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((Math.abs(remaining) % (1000 * 60)) / 1000);

  const twoHours = 2 * 60 * 60 * 1000;

  let colorClass = 'text-f-green-60';
  if (isExpired) {
    colorClass = 'font-bold text-f-red-60';
  } else if (remaining < twoHours) {
    colorClass = 'font-semibold text-f-orange-60';
  }

  const timeStr = `${isExpired ? '-' : ''}${hours}h ${minutes}m ${seconds}s`;

  return (
    <span className={cn('text-sm tabular-nums', colorClass, className)}>
      {timeStr}
    </span>
  );
}
