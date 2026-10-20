'use client';

/**
 * 右側「設定進度」：每個區塊的完成狀態與目前選擇摘要，點擊捲到該區塊。
 * 窄螢幕（< lg）改放在表單上方，可展開或收合。
 */
import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SectionId, WorstCost } from './form-model';

export interface ProgressItem {
  id: SectionId;
  num: number;
  title: string;
  summary: string;
  done: boolean;
  hasError: boolean;
}

interface Props {
  /** desktop：右側固定（lg 以上）；mobile：表單上方可收合（lg 以下） */
  variant: 'desktop' | 'mobile';
  items: ProgressItem[];
  worst: WorstCost | null;
  onJump: (id: SectionId) => void;
}

function List({ items, onJump }: Pick<Props, 'items' | 'onJump'>) {
  return (
    <ol className="flex flex-col gap-0.5">
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            onClick={() => onJump(it.id)}
            aria-label={`${it.num}. ${it.title}，${it.done ? '已完成' : '未完成'}，${it.summary}`}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              it.hasError && 'shadow-[inset_3px_0_0_hsl(var(--destructive))]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold',
                it.done ? 'bg-success text-success-foreground' : 'border-[1.5px] border-muted-foreground bg-background text-muted-foreground',
              )}
            >
              {it.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : it.num}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-[13px] font-semibold', it.hasError ? 'text-destructive' : 'text-foreground')}>{it.title}</span>
              <span className="block break-words text-xs text-muted-foreground">{it.summary}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function ProgressAside({ variant, items, worst, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const doneCount = items.filter((i) => i.done).length;
  if (variant === 'desktop') {
    return (
      <aside aria-label="設定進度" className="sticky top-6 hidden w-[248px] shrink-0 self-start lg:block">
        <h2 className="mb-2 px-2.5 text-xs font-medium text-muted-foreground">設定進度</h2>
        <List items={items} onJump={onJump} />
        {worst && (
          <div className="mt-3 rounded-lg border bg-muted/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-muted-foreground">最壞成本</span>
              <span className={cn('rounded-full px-2 py-px font-medium', worst.bounded ? 'bg-muted text-muted-foreground' : 'bg-warning-subtle text-warning')}>
                {worst.bounded ? '已封頂' : '請確認'}
              </span>
            </div>
            <p className={cn('mt-1 font-mono text-[15px] font-semibold', worst.bounded ? 'text-foreground' : 'text-warning')}>{worst.cost}</p>
            <p className="font-mono text-xs text-muted-foreground">{worst.formula}</p>
          </div>
        )}
      </aside>
    );
  }
  return (
      <div className="rounded-xl border bg-background lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="coupon-progress-mobile"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium"
        >
          <span>
            設定進度 <span className="font-mono text-muted-foreground">{doneCount}/{items.length}</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {open ? '收合' : '展開'}
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </span>
        </button>
        {open && (
          <div id="coupon-progress-mobile" className="border-t px-2 py-2">
            <List items={items} onJump={onJump} />
          </div>
        )}
      </div>
  );
}
