'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { ChannelType } from '@open333crm/shared';

interface ChannelBadgeProps {
  channel: ChannelType | string;
  className?: string;
}

// Per Figma "Tag / Channel" spec — paired bg + text colors
const channelConfig: Record<string, { bg: string; text: string; label: string }> = {
  LINE: { bg: 'bg-[#EEF5F0]', text: 'text-[#008236]', label: 'LINE' },
  FB: { bg: 'bg-[#EFF6FF]', text: 'text-[#378ADD]', label: 'FB' },
  WEBCHAT: { bg: 'bg-neutral-30', text: 'text-ink-subtle', label: 'WebChat' },
  WHATSAPP: { bg: 'bg-[#E8F8EE]', text: 'text-[#075E54]', label: 'WhatsApp' },
  EMAIL: { bg: 'bg-brand-10', text: 'text-brand-80', label: 'Email' },
  SMS: { bg: 'bg-f-orange-10', text: 'text-f-orange-80', label: 'SMS' },
};

export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  const config = channelConfig[channel] || {
    bg: 'bg-neutral-30',
    text: 'text-ink-subtle',
    label: channel,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-card px-2 py-0 text-[12px] font-semibold leading-5',
        config.bg,
        config.text,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
