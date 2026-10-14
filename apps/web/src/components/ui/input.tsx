'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Input — 依 Figma「Form / Input Row」輸入框
 * 高 48（Large）、圓角 12、左右內距 16、白底 #E2E8F0 框、14px 字、placeholder #919191
 * Focus 藍框 #378ADD；停用 #F5F5F5 底；aria-invalid 時紅框（Figma Type=Error）
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-12 w-full rounded-lg border border-input bg-background px-4 py-3 text-sm leading-5 text-foreground transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-status-neutral focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-shell disabled:font-medium disabled:text-status-neutral aria-[invalid=true]:border-destructive',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
