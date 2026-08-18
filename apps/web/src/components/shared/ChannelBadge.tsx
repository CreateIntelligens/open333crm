'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { ChannelType } from '@open333crm/shared';

/**
 * ChannelBadge — 對齊 Figma「Tag / Metadata」通道徽章
 * 保留各通道品牌識別色，圓角 12px。
 */
interface ChannelBadgeProps {
  channel: ChannelType | string;
  className?: string;
}

const channelConfig: Record<string, { className: string; label: string }> = {
  LINE: { className: 'bg-success-subtle text-success', label: 'LINE' },
  FB: { className: 'bg-primary-subtle text-primary', label: 'Facebook' },
  THREADS: { className: 'bg-ai-subtle text-ai', label: 'Instagram' },
  WEBCHAT: { className: 'bg-muted text-muted-foreground', label: 'WebChat' },
  WHATSAPP: { className: 'bg-success-subtle text-success', label: 'WhatsApp' },
  EMAIL: { className: 'bg-ai-subtle text-ai', label: 'Email' },
};

export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  const config = channelConfig[channel] || {
    className: 'bg-muted text-muted-foreground',
    label: channel,
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
