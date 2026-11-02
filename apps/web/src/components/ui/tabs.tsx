'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs — 對齊 Figma「Tab / Underline」與 Pill 兩種樣式。
 * variant="pill" (預設，灰底浮起) 或 "underline" (底線)。
 * API 與原本相容：<Tabs value onValueChange>。
 */

type TabsVariant = 'pill' | 'underline';

const TabsCtx = React.createContext<{ variant: TabsVariant; idPrefix: string }>({ variant: 'pill', idPrefix: 'tabs' });

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  variant?: TabsVariant;
}

function Tabs({ value, onValueChange, children, className, variant = 'pill' }: TabsProps) {
  const idPrefix = React.useId().replace(/:/g, '');
  return (
    <TabsCtx.Provider value={{ variant, idPrefix }}>
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
  'aria-label'?: string;
  'aria-labelledby'?: string;
  activeValue?: string;
  onValueChange?: (value: string) => void;
}

function TabsList({ children, className, activeValue, onValueChange, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy }: TabsListProps) {
  const { variant } = React.useContext(TabsCtx);
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation="horizontal"
      className={cn(
        'inline-flex items-center justify-start text-muted-foreground',
        variant === 'pill'
          ? 'h-10 rounded-lg bg-muted p-1'
          : 'h-11 gap-1 border-b border-border',
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
  const { variant, idPrefix } = React.useContext(TabsCtx);
  const isActive = activeValue === value;
  const suffix = value.replace(/[^a-zA-Z0-9_-]/g, '-');
  const tabId = `${idPrefix}-tab-${suffix}`;
  const panelId = `${idPrefix}-panel-${suffix}`;
  return (
    <button
      type="button"
      id={tabId}
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
        variant === 'pill'
          ? cn('rounded-md px-3 py-1.5', isActive && 'bg-background text-foreground shadow-soft')
          : cn(
              'relative -mb-px h-11 border-b-2 border-transparent px-3',
              isActive ? 'border-primary text-primary' : 'hover:text-foreground'
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
  const { idPrefix } = React.useContext(TabsCtx);
  if (activeValue !== value) return null;
  const suffix = value.replace(/[^a-zA-Z0-9_-]/g, '-');
  return (
    <div
      id={`${idPrefix}-panel-${suffix}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${suffix}`}
      tabIndex={0}
      className={cn('mt-3 focus-visible:outline-none', className)}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
