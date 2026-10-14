'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs — 依 Figma「Tab / Underline」(589:10108) 與「Segmented Control」(922:33662)
 * variant="pill"（預設）：#F8FAFC 底、內距 4、間距 4、圓角 8；選中項白底
 * variant="underline"：每項內距 12/12/8、14px；選中藍字 600＋藍色底線，未選中 #707E93 500
 * API 與原本相容：<Tabs value onValueChange>。
 */

type TabsVariant = 'pill' | 'underline';

const TabsCtx = React.createContext<{ variant: TabsVariant }>({ variant: 'pill' });

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  variant?: TabsVariant;
}

function Tabs({ value, onValueChange, children, className, variant = 'pill' }: TabsProps) {
  return (
    <TabsCtx.Provider value={{ variant }}>
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
    </TabsCtx.Provider>
  );
}

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  activeValue?: string;
  onValueChange?: (value: string) => void;
}

function TabsList({ children, className, activeValue, onValueChange }: TabsListProps) {
  const { variant } = React.useContext(TabsCtx);
  return (
    <div
      className={cn(
        'inline-flex items-center justify-start text-muted-foreground',
        variant === 'pill'
          ? 'h-9 gap-1 rounded-md bg-muted p-1'
          : 'gap-1 border-b border-border',
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
  const { variant } = React.useContext(TabsCtx);
  const isActive = activeValue === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
        variant === 'pill'
          ? cn('h-7 rounded-md px-4 text-foreground', isActive ? 'bg-background font-medium' : 'font-normal hover:bg-background/60')
          : cn(
              'relative -mb-px border-b-2 px-3 pb-2 pt-3',
              isActive ? 'border-primary font-semibold text-primary' : 'border-transparent font-medium text-muted-foreground hover:text-foreground'
            ),
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
    <div className={cn('mt-3 focus-visible:outline-none', className)}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
