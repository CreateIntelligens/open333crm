'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { ChannelBadge } from './ChannelBadge';

interface ChannelLabelProps {
  channelType: string;
  /** 渠道名稱（例如「總店官方帳號」）；同一租戶可能接多個 LINE OA／粉專，用來分辨是哪一個 */
  channelName?: string | null;
  /** 名稱最大寬度（Tailwind class），空間窄的地方（對話列表）要限制寬度讓它截斷 */
  nameClassName?: string;
  className?: string;
}

/**
 * 渠道標示：品牌色類型徽章＋灰色渠道名稱。名稱過長自動截斷，滑鼠移上顯示全名。
 * 沒有名稱時只顯示徽章（與原本的 ChannelBadge 相同）。
 */
export function ChannelLabel({ channelType, channelName, nameClassName, className }: ChannelLabelProps) {
  const name = channelName?.trim();
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ChannelBadge channel={channelType} className="shrink-0" />
      {name && (
        <span className={cn('truncate text-xs text-muted-foreground', nameClassName)} title={name}>
          {name}
        </span>
      )}
    </span>
  );
}
