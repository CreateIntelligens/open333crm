'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Chip — 依 Figma Design System「Chip / Filter」
 * 膠囊形（圓角 20）。Large 高 36（篩選列）、Small 高 28（列表裡的狀態）。
 * tone：primary＝藍底白字（選中、啟用、已發布）；default＝#F5F5F5 底灰字；
 *       outline＝#F5F5F5 底＋#C6CFDD 框；ghost＝無底灰字（否、未設定）
 * 傳 onClick 會變成按鈕（篩選用，帶 aria-pressed），沒傳就是純顯示。
 */
const chipVariants = cva(
  'inline-flex items-center justify-center gap-0.5 whitespace-nowrap rounded-full font-medium transition-colors',
  {
    variants: {
      tone: {
        primary: 'border border-primary bg-primary text-white',
        default: 'border border-transparent bg-shell text-tertiary-foreground',
        outline: 'border border-control-disabled bg-shell text-tertiary-foreground',
        ghost: 'border border-transparent text-status-neutral',
      },
      size: {
        sm: 'h-7 px-3 text-xs leading-4',
        lg: 'h-9 px-4 text-sm leading-5',
      },
    },
    defaultVariants: { tone: 'default', size: 'sm' },
  },
);

interface ChipProps extends VariantProps<typeof chipVariants> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  title?: string;
}

export function Chip({ tone, size, className, onClick, selected, title, children }: ChipProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        title={title}
        className={cn(
          chipVariants({ tone, size }),
          !selected && 'hover:bg-black/5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          className,
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={cn(chipVariants({ tone, size }), className)}>
      {children}
    </span>
  );
}
