'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export function Checkbox({ id, checked, onCheckedChange, className, disabled }: CheckboxProps) {
  return (
    <span className="inline-flex min-h-11 min-w-11 items-center justify-center">
      <input
        id={id}
        type="checkbox"
        checked={checked ?? false}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        disabled={disabled}
        className={cn(
          'h-5 w-5 rounded border border-input bg-background cursor-pointer accent-primary',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
      />
    </span>
  );
}
