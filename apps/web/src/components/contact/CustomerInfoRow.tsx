'use client';

import React from 'react';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ContactTagVariant = 'identity' | 'alert' | 'topic';

interface ContactTag {
  label: string;
  variant: ContactTagVariant;
}

interface InfoItem {
  label: string;
  value: React.ReactNode;
  /** Render value in green (e.g. warranty remaining days) */
  emphasize?: boolean;
}

interface CustomerInfoRowProps {
  /** Primary contact (phone, line id, etc.) shown beside an icon */
  contact?: { value: string; icon?: React.ReactNode };
  tags?: ContactTag[];
  items?: InfoItem[];
  className?: string;
}

const TAG_STYLES: Record<ContactTagVariant, string> = {
  identity: 'bg-[#FFFBEB99] text-[#BB4D00]',
  alert: 'bg-[#FFECED99] text-[#EE3134]',
  topic: 'bg-[#F5F5F599] text-[#727272]',
};

export function CustomerInfoRow({
  contact,
  tags,
  items,
  className,
}: CustomerInfoRowProps) {
  return (
    <div className={cn('flex w-full flex-col gap-3', className)}>
      {contact && (
        <div className="flex items-center gap-1 text-ink-subtle">
          <span className="flex h-5 w-5 items-center justify-center">
            {contact.icon ?? <Phone className="h-[14px] w-[14px]" strokeWidth={1.5} />}
          </span>
          <span className="text-[14px] font-medium leading-5">{contact.value}</span>
        </div>
      )}

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 py-1">
          {tags.map((tag, i) => (
            <span
              key={`${tag.variant}-${tag.label}-${i}`}
              className={cn(
                'inline-flex h-5 items-center rounded-chip px-2 text-[12px] font-medium leading-4',
                TAG_STYLES[tag.variant],
              )}
            >
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-1">
          {items.map((item, i) => (
            <div
              key={`${item.label}-${i}`}
              className="flex items-center justify-between gap-3 text-[14px] leading-5"
            >
              <span className="text-ink-subtle">{item.label}</span>
              <span
                className={cn(
                  'text-right',
                  item.emphasize ? 'text-[#00AB50] font-medium' : 'text-ink-subtle',
                )}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
