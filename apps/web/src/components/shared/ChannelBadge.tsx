'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { ChannelType } from '@open333crm/shared';
import { channelTypeName } from './ChannelLogo';

/**
 * ChannelBadge — 對齊 Figma「Tag / Metadata」通道徽章
 * 保留各通道品牌識別色，圓角 12px。
 */
interface ChannelBadgeProps {
  channel: ChannelType | string;
  className?: string;
}

const channelClassName: Record<string, string> = {
  LINE: 'bg-success-subtle text-success',
  FB: 'bg-primary-subtle text-primary',
  THREADS: 'bg-ai-subtle text-ai',
  WEBCHAT: 'bg-muted text-muted-foreground',
  WHATSAPP: 'bg-success-subtle text-success',
  EMAIL: 'bg-ai-subtle text-ai',
};

export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  const config = {
    className: channelClassName[channel] ?? 'bg-muted text-muted-foreground',
    label: channelTypeName(channel),
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
