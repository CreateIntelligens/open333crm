'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Button — 對齊 Figma「Button」元件集 (429:8357)
 * Type: Primary / Secondary / Outline / Subtle / Ghost / Destructive / AI / Link
 * Size: xs(h32) / sm(h36) / default(h40) / lg(h44) / icon
 * 圓角 8px (md)，含 loading 狀態。
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary 藍底白字，hover 深藍 #2876C4
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        // Secondary 深藍實心 (Figma 第二排)
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        // Subtle 淡藍底藍字
        subtle: 'bg-primary-subtle text-primary hover:bg-primary-subtle/70',
        // Outline 白底藍框
        outline: 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        // Ghost 無底
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        // Destructive 紅
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // AI / Bot 紫 (自動化功能專用)
        ai: 'bg-ai text-ai-foreground hover:bg-ai/90',
        // Link
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-8 px-3 text-xs',        // XS 32px
        sm: 'h-9 px-3.5',               // S 36px
        default: 'h-10 px-4',           // M 40px
        lg: 'h-11 px-5 text-base',      // L 44px
        icon: 'h-10 w-10',
        'icon-sm': 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
