'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface VariableMeta {
  key: string;
  label: string;
  example: string;
}

export interface VariableCategory {
  category: string;
  variables: VariableMeta[];
}

interface VariablePickerProps {
  categories: VariableCategory[];
  onInsert: (variable: VariableMeta) => void;
  disabled?: boolean;
}

export function VariablePicker({ categories, onInsert, disabled }: VariablePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = search.trim()
    ? categories
        .map((cat) => ({
          ...cat,
          variables: cat.variables.filter(
            (v) =>
              v.key.toLowerCase().includes(search.toLowerCase()) ||
              v.label.toLowerCase().includes(search.toLowerCase()),
          ),
        }))
        .filter((cat) => cat.variables.length > 0)
    : categories;

  const handleSelect = (v: VariableMeta) => {
    onInsert(v);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="h-7 gap-1 px-2 text-xs"
      >
        插入變數
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-background shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋變數..."
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">找不到符合的變數</p>
            ) : (
              filtered.map((cat) => (
                <div key={cat.category}>
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {cat.category}
                  </p>
                  {cat.variables.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => handleSelect(v)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs',
                        'hover:bg-accent hover:text-accent-foreground transition-colors',
                      )}
                    >
                      <span className="font-medium">{v.label}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate">
                        {`{{${v.key}}}`}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
