'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

function DropdownMenu({ trigger, children, align = 'left', className }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn('relative inline-block', className)} ref={menuRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>
      {isOpen && (
        <div
          className={cn(
            'absolute z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border bg-background p-1 shadow-md',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {React.Children.map(children, (child) => {
            if (React.isValidElement<{ onClick?: () => void }>(child)) {
              const originalOnClick = child.props.onClick;
              return React.cloneElement(child, {
                onClick: () => {
                  originalOnClick?.();
                  setIsOpen(false);
                },
              } as Record<string, unknown>);
            }
            return child;
          })}
        </div>
      )}
    </div>
  );
}

interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  destructive?: boolean;
}

function DropdownMenuItem({ className, destructive, children, ...props }: DropdownMenuItemProps) {
  return (
    <div
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
        destructive && 'text-destructive hover:text-destructive',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { DropdownMenu, DropdownMenuItem };
