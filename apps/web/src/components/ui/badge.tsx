'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge / Tag — 對齊 Figma 標籤系統 (Tag/CaseStatus、Tag/Priority、Tag/Metadata)
 * 圓角 12px (rounded-lg)、12px 半粗字。語意色皆「深字 + 淺底」成對。
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-border text-foreground',
        // 語意「淺底深字」變體 (對齊 Figma 狀態標籤)
        success: 'border-transparent bg-success-subtle text-success',
        warning: 'border-transparent bg-warning-subtle text-warning',
        danger: 'border-transparent bg-destructive-subtle text-destructive',
        info: 'border-transparent bg-primary-subtle text-primary',
        ai: 'border-transparent bg-ai-subtle text-ai',
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
