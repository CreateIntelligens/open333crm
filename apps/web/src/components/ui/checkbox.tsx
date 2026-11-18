'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Checkbox — 依 Figma「Checkbox」(1379:13310) 的勾選框圖示
 * 16px 方框、圓角 4：未勾選白底 #C6CFDD 1.5px 框；勾選藍底 #378ADD＋白勾
 */
interface CheckboxProps {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

const CHECK_MARK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M12 5L6.5 10.5L4 8' stroke='white' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

export function Checkbox({ id, checked, onCheckedChange, className, disabled, ...rest }: CheckboxProps) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked ?? false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      disabled={disabled}
      aria-label={rest['aria-label']}
      style={checked ? { backgroundImage: CHECK_MARK } : undefined}
      className={cn(
        'h-4 w-4 flex-none cursor-pointer appearance-none rounded-[4px] border-[1.5px] border-control-disabled bg-background bg-center bg-no-repeat transition-colors',
        'checked:border-primary checked:bg-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    />
  );
}
