'use client';

/**
 * 表單的基本元件：欄位外框（標籤、說明、錯誤）、文字／數字輸入、鎖定唯讀、選項卡片、提示框。
 * 色彩一律用 globals.css 的 token，深色模式自動切換。
 */
import React, { useRef } from 'react';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GroupOption } from './form-model';

export const LOCKED_NOTE = '優惠券發布後無法修改';

export interface FieldMessages {
  help?: string;
  /** 即時資訊（例如「＝打 85 折」） */
  info?: string;
  /** 不擋送出的警告 */
  warn?: string;
  error?: string;
}

interface ShellProps extends FieldMessages {
  id: string;
  label: string;
  required?: boolean;
  locked?: boolean;
  /** 標籤右側的小標，例如「預設」 */
  tag?: string;
  /** 標籤下方的說明 */
  desc?: string;
  /** 右下角的字數計數 */
  counter?: string;
  className?: string;
  children: (a11y: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
}

/** 欄位外框：處理 label 對應、說明與錯誤的 aria-describedby。 */
export function FieldShell({ id, label, required, locked, tag, desc, counter, help, info, warn, error, className, children }: ShellProps) {
  // 鎖定時只顯示「優惠券發布後無法修改」，其他提示都不顯示
  const showHelp = locked ? LOCKED_NOTE : help;
  const describedBy = [
    desc && `${id}-desc`,
    showHelp && `${id}-help`,
    !locked && info && `${id}-info`,
    !locked && !error && warn && `${id}-warn`,
    !locked && error && `${id}-err`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} data-cell>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {tag && (
          <span className="rounded-full border bg-muted px-2 py-px text-xs font-medium text-muted-foreground">{tag}</span>
        )}
      </div>
      {desc && (
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {desc}
        </p>
      )}
      {children({ id, 'aria-describedby': describedBy || undefined, 'aria-invalid': !locked && error ? true : undefined })}
      {(showHelp || counter) && (
        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <span id={showHelp ? `${id}-help` : undefined}>{showHelp}</span>
          {counter && !locked && <span className="shrink-0 font-mono">{counter}</span>}
        </div>
      )}
      {!locked && info && (
        <p id={`${id}-info`} className="text-xs font-medium text-primary">
          {info}
        </p>
      )}
      {!locked && !error && warn && (
        <p id={`${id}-warn`} className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {warn}
        </p>
      )}
      {!locked && error && (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface InputProps extends FieldMessages {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  required?: boolean;
  locked?: boolean;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  mono?: boolean;
  type?: 'text' | 'date';
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  min?: string;
  /** 寬度：full 佔滿、narrow 約 150px、pin 約 132px */
  width?: 'full' | 'narrow' | 'pin';
  tag?: string;
  desc?: string;
  counter?: string;
  className?: string;
}

/** 單行輸入；鎖定時改為唯讀灰框＋鎖頭圖示。 */
export function TextField({
  id, label, value, onChange, onBlur, required, locked, placeholder, prefix, suffix, mono, type = 'text',
  inputMode, maxLength, min, width = 'full', tag, desc, counter, help, info, warn, error, className,
}: InputProps) {
  const invalid = !locked && !!error;
  return (
    <FieldShell
      id={id} label={label} required={required} locked={locked} tag={tag} desc={desc} counter={counter}
      help={help} info={info} warn={warn} error={error} className={className}
    >
      {(a11y) => (
        <div
          className={cn(
            'flex h-10 items-center overflow-hidden rounded-lg border text-sm transition-colors',
            width === 'full' && 'w-full',
            width === 'narrow' && 'w-[150px]',
            width === 'pin' && 'w-[150px]',
            locked
              ? 'border-border bg-muted text-foreground'
              : cn(
                  'bg-background focus-within:ring-2',
                  invalid
                    ? 'border-destructive focus-within:ring-destructive/30'
                    : warn
                      ? 'border-warning/60 focus-within:border-primary focus-within:ring-ring/30'
                      : 'border-input focus-within:border-primary focus-within:ring-ring/30',
                ),
          )}
        >
          {locked && <Lock className="ml-3 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {prefix && <span className="pl-3 text-muted-foreground">{prefix}</span>}
          <input
            {...a11y}
            type={type}
            value={value}
            readOnly={locked}
            aria-readonly={locked || undefined}
            aria-required={required || undefined}
            placeholder={locked ? '—' : placeholder}
            inputMode={inputMode}
            maxLength={maxLength}
            min={min}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={cn(
              'h-full min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-muted-foreground',
              mono && 'font-mono tracking-wider',
              locked && 'cursor-default font-medium',
            )}
          />
          {suffix && <span className="whitespace-nowrap pr-3 text-muted-foreground">{suffix}</span>}
        </div>
      )}
    </FieldShell>
  );
}

interface RadioCardsProps {
  /** 群組 id，選項的 DOM id 為 {idPrefix}-{value} */
  idPrefix: string;
  label: string;
  caption: string;
  options: GroupOption[];
  value: string;
  onChange: (value: string) => void;
  locked?: boolean;
  /** 已嘗試發布而未選：框變紅並顯示「此欄位必填」 */
  missing?: boolean;
  columns?: 2 | 3 | 4;
}

/**
 * 選項卡片（radio card）：role=radiogroup，方向鍵切換並選取，Tab 只停在目前選項（roving tabindex）。
 * 預設都不選；未選時第一個選項可被 Tab 聚焦。
 */
export function RadioCards({ idPrefix, label, caption, options, value, onChange, locked, missing, columns }: RadioCardsProps) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const labelId = `${idPrefix}-label`;
  const errId = `${idPrefix}-err`;
  const current = options.findIndex((o) => o.value === value);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const cols = columns ?? (options.length >= 4 ? 4 : options.length === 3 ? 3 : 2);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span id={labelId} className="font-semibold text-foreground">
          {label}
        </span>
        <span className="text-xs font-medium text-destructive">必填</span>
        <span className="text-xs text-muted-foreground">{caption}</span>
        {locked && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {LOCKED_NOTE}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-required="true"
        aria-disabled={locked || undefined}
        aria-invalid={missing || undefined}
        aria-describedby={missing ? errId : undefined}
        className={cn(
          'grid grid-cols-1 gap-2.5',
          cols === 2 && 'sm:grid-cols-2',
          cols === 3 && 'sm:grid-cols-3',
          cols === 4 && 'sm:grid-cols-2 xl:grid-cols-4',
        )}
      >
        {options.map((o, i) => {
          const on = o.value === value;
          const focusable = current === -1 ? i === 0 : on;
          return (
            <div
              key={o.value}
              id={`${idPrefix}-${o.value}`}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={on}
              aria-disabled={locked || undefined}
              tabIndex={focusable ? 0 : -1}
              onClick={() => !locked && onChange(o.value)}
              onKeyDown={(e) => {
                if (locked) return;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(i, -1);
                } else if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onChange(o.value);
                }
              }}
              className={cn(
                'flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                on
                  ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary))]'
                  : missing
                    ? 'border-destructive bg-background'
                    : 'border-input bg-background',
                locked ? cn('cursor-not-allowed', on ? 'opacity-90' : 'opacity-50') : 'cursor-pointer hover:border-primary/60',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
                  on ? 'bg-primary' : 'border-[1.5px] border-muted-foreground bg-background',
                )}
              >
                {on && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold', on ? 'text-primary' : 'text-foreground')}>{o.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </div>
          );
        })}
      </div>
      {missing && (
        <p id={errId} className="text-xs text-destructive" role="alert">
          此欄位必填
        </p>
      )}
    </div>
  );
}

/** 選項下方的提示框：info（一般說明）、caution（取捨提醒）、warn（警告） */
export function Note({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'caution' | 'warn';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = tone === 'warn' ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        'flex items-start gap-2 text-sm',
        tone === 'info' && 'text-muted-foreground',
        tone === 'caution' && 'rounded-lg border bg-background px-3 py-2.5 text-foreground',
        tone === 'warn' && 'rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2.5 text-warning',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-warning' : 'text-muted-foreground')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/** 選了選項後出現的欄位面板（淺藍底） */
export function OptionPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[10px] border border-primary/20 bg-primary/5 px-4 py-3.5">{children}</div>
  );
}
