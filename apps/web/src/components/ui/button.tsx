'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Button — 依 Figma Design System「Button」(429:8357)
 * 共同：圓角 8、左右內距 16、圖示與文字間距 8、圖示 20（XS 為 16）
 * Size：L 44 / M 40（16px）、S 36 / XS 32（14px）
 * Type（variant 名稱沿用舊 API）：
 *   default=Primary 藍底白字 600、hover #2876C4、停用 #D0D0D0
 *   secondary=Secondary 淡藍底 #EFF6FF＋藍框藍字
 *   outline=Outline 白底＋#6D6D6D 框
 *   subtle=Subtle 白底＋#E2E8F0 框
 *   ghost=Ghost 無框 #6D6D6D 字
 *   destructive / ai / link：Figma 未定義，維持專案原有用途
 * Loading：#F5F5F5 底、#6D6D6D 字（Figma State=Loading）
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary font-semibold text-white hover:bg-primary-hover disabled:bg-disabled-solid disabled:font-medium disabled:opacity-100',
        secondary: 'border border-primary bg-primary-subtle text-primary hover:bg-primary-subtle/60',
        outline: 'border border-tertiary-foreground bg-background text-tertiary-foreground hover:bg-shell',
        subtle: 'border border-border bg-background text-tertiary-foreground hover:bg-shell',
        ghost: 'text-tertiary-foreground hover:bg-shell',
        destructive: 'bg-destructive font-semibold text-destructive-foreground hover:bg-destructive/90',
        ai: 'bg-ai font-semibold text-ai-foreground hover:bg-ai/90',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-8 px-4 text-sm [&_svg]:size-4', // XS 32
        sm: 'h-9 px-4 text-sm',                // S 36
        default: 'h-10 px-4 text-base',        // M 40
        lg: 'h-11 px-4 text-base',             // L 44
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
        className={cn(
          buttonVariants({ variant, size }),
          loading && 'border-transparent bg-shell text-tertiary-foreground disabled:bg-shell disabled:opacity-100',
          className,
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
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
