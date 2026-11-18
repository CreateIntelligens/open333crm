'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Switch — 依 Figma「Switch」(3667:38086)
 * 44×24 膠囊：開＝藍 #378ADD、關＝#C6CFDD；20px 白色圓鈕
 * 可選 title／description：標題 16px 500 #37404C、說明 14px #707E93、與開關間距 12
 */
interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function Switch({ id, checked, onCheckedChange, disabled, title, description, className, ...rest }: SwitchProps) {
  const autoId = React.useId();
  const switchId = id ?? autoId;
  const toggle = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title ? undefined : rest['aria-label']}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-control-disabled',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-5 w-5 rounded-full bg-white shadow-xs transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')}
      />
    </button>
  );
  if (!title && !description) return <span className={className}>{toggle}</span>;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      {toggle}
      <label htmlFor={switchId} className="flex cursor-pointer flex-col gap-1">
        {title && <span className="text-base font-medium leading-6 text-foreground">{title}</span>}
        {description && <span className="text-sm leading-5 text-muted-foreground">{description}</span>}
      </label>
    </div>
  );
}
