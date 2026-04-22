'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ChannelBadgeProps {
  channel: string;
  className?: string;
}

const channelConfig: Record<string, { bg: string; text: string; label: string }> = {
  LINE: { bg: 'bg-[#eef5f0]', text: 'text-[#589e67]', label: 'LINE' },
  line: { bg: 'bg-[#eef5f0]', text: 'text-[#589e67]', label: 'LINE' },
  FACEBOOK: { bg: 'bg-[#edf2fe]', text: 'text-[#4976f4]', label: 'Facebook' },
  facebook: { bg: 'bg-[#edf2fe]', text: 'text-[#4976f4]', label: 'Facebook' },
  FB: { bg: 'bg-[#edf2fe]', text: 'text-[#4976f4]', label: 'Facebook' },
  fb: { bg: 'bg-[#edf2fe]', text: 'text-[#4976f4]', label: 'Facebook' },
  WEBCHAT: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'WebChat' },
  webchat: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'WebChat' },
  WEB: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'WebChat' },
  web: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'WebChat' },
  EMAIL: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Email' },
  email: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Email' },
};

export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  const config = channelConfig[channel] || {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: channel,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        config.bg,
        config.text,
        className
      )}
    >
      {config.label}
    </span>
  );
}
