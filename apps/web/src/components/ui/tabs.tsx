'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <div className={cn('w-full', className)} data-value={value}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement<{ value?: string; activeValue?: string; onValueChange?: (v: string) => void }>(child)) {
          return React.cloneElement(child, {
            activeValue: value,
            onValueChange,
          } as Record<string, unknown>);
        }
        return child;
      })}
    </div>
  );
}

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  activeValue?: string;
  onValueChange?: (value: string) => void;
}

function TabsList({ children, className, activeValue, onValueChange }: TabsListProps) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement<{ activeValue?: string; onValueChange?: (v: string) => void }>(child)) {
          return React.cloneElement(child, {
            activeValue,
            onValueChange,
          } as Record<string, unknown>);
        }
        return child;
      })}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  activeValue?: string;
  onValueChange?: (value: string) => void;
}

function TabsTrigger({ value, children, className, activeValue, onValueChange }: TabsTriggerProps) {
  const isActive = activeValue === value;
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        isActive && 'bg-background text-foreground shadow-sm',
        className
      )}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  activeValue?: string;
}

function TabsContent({ value, children, className, activeValue }: TabsContentProps) {
  if (activeValue !== value) return null;
  return (
    <div className={cn('mt-2 ring-offset-background focus-visible:outline-none', className)}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
