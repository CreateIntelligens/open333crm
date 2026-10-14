'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge — 依 Figma Design System「Tag」(1697:14324)
 * 高 22、圓角 12、左右內距 12、12px 字。
 * Style：Solid（實心白字 600）／Soft（淡底深字）／Outline（淡底＋同色框）
 * Color：Neutral / Primary / Success / Danger / Warning / Robot
 * 舊的 variant 名稱保留並對應到 Figma 樣式，既有頁面不用改。
 */
const badgeVariants = cva(
  'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-lg border border-transparent px-3 text-xs font-semibold leading-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        // Solid
        default: 'bg-primary text-white',
        destructive: 'bg-destructive text-white',
        'solid-neutral': 'bg-status-neutral text-white',
        'solid-success': 'bg-online text-white',
        'solid-warning': 'bg-warning text-white',
        'solid-robot': 'bg-robot text-white',
        // Soft
        secondary: 'bg-shell text-tertiary-foreground',
        info: 'bg-primary-subtle text-primary-hover',
        success: 'bg-success-subtle text-success',
        danger: 'bg-destructive-subtle font-medium text-destructive',
        warning: 'bg-warning-subtle font-medium text-warning',
        ai: 'bg-ai-subtle font-medium text-robot',
        // Outline
        outline: 'border-control-disabled bg-shell text-tertiary-foreground',
        'outline-primary': 'border-primary bg-primary-subtle text-primary-hover',
        'outline-success': 'border-success bg-success-subtle text-success',
        'outline-danger': 'border-destructive bg-destructive-subtle font-medium text-destructive',
        'outline-warning': 'border-warning bg-warning-subtle font-medium text-warning',
        'outline-robot': 'border-robot bg-ai-subtle font-medium text-robot',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  color?: string;
}

function Badge({ className, variant, color, ...props }: BadgeProps) {
  const colorStyle = color
    ? { backgroundColor: color, color: '#fff', borderColor: color }
    : undefined;

  return (
    <div
      className={cn(badgeVariants({ variant: color ? undefined : variant }), className)}
      style={colorStyle}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
