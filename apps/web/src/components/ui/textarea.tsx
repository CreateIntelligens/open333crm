'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/** Textarea — 與 Input 相同的 Figma 輸入框樣式（圓角 12、內距 16/12） */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-lg border border-input bg-background px-4 py-3 text-sm leading-5 text-foreground transition-colors placeholder:text-status-neutral focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-shell disabled:text-status-neutral aria-[invalid=true]:border-destructive',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
