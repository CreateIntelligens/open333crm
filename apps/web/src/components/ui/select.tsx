'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Select — 依 Figma「Dropdown / Trigger」(Large)
 * 高 44、圓角 12、#F8FAFC 底 #E2E8F0 框、14px 500 字、右側 20px 向下箭頭；hover #F5F5F5、focus 藍框
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-11 w-full cursor-pointer appearance-none rounded-lg border border-input bg-muted bg-[length:20px_20px] bg-[right_12px_center] bg-no-repeat py-2 pl-3 pr-10 text-sm font-medium leading-5 text-foreground transition-colors [background-image:url(/icons/figma/chevron-down.svg)] hover:bg-shell focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:text-status-neutral',
          className
        )}
        ref={ref}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
);
Select.displayName = 'Select';

export { Select };
