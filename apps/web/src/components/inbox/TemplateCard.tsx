'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type TemplateCardType = 'Flex' | 'Text' | 'Image' | 'QuickReply' | 'Carousel' | string;

interface TemplateCardProps {
  title: string;
  subtitle?: string;
  type?: TemplateCardType;
  usageCount?: number;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

const TYPE_STYLES: Record<string, string> = {
  Flex: 'bg-surface-active text-[#378ADD]',
  Text: 'bg-neutral-30 text-ink',
  Image: 'bg-f-orange-10 text-f-orange-80',
  QuickReply: 'bg-f-lime-10 text-f-lime-80',
  Carousel: 'bg-brand-10 text-brand-80',
};

export function TemplateCard({
  title,
  subtitle,
  type = 'Flex',
  usageCount,
  selected = false,
  disabled = false,
  onClick,
  className,
}: TemplateCardProps) {
  const typeClass = TYPE_STYLES[type] ?? TYPE_STYLES.Flex;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full flex-col items-stretch gap-2 rounded-card border p-4 text-left transition-all',
        'border-surface-line bg-white hover:bg-neutral-30',
        selected &&
          'border-[1.5px] border-[#378ADD] bg-white shadow-[0_0_12px_0_rgba(55,138,221,0.25)] hover:bg-white',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-white',
        className,
      )}
    >
      {/* Meta row: type tag + usage count */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex h-[20px] items-center rounded-card px-2 text-[12px] font-semibold leading-5',
            typeClass,
          )}
        >
          {type}
        </span>
        {typeof usageCount === 'number' && (
          <span className="text-[12px] font-medium leading-6 text-[#727272]">
            使用 {usageCount.toLocaleString()} 次
          </span>
        )}
      </div>

      {/* Title + subtitle */}
      <div className="flex flex-col">
        <span className="text-[16px] font-semibold leading-6 text-ink">{title}</span>
        {subtitle && (
          <span className="text-[14px] font-medium leading-6 text-ink-subtle">{subtitle}</span>
        )}
      </div>
    </button>
  );
}
