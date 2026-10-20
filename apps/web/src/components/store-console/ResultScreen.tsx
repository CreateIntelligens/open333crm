'use client';

/**
 * 核銷結果（mobile-prototype-spec 2.8）：成功、失敗、網路不穩與帳號錯誤共用一張狀態卡。
 * 頂列「核銷結果」→ 狀態卡（分類＋標題＋說明或 K/V＋標籤）→ 核銷明細 →「可以這樣跟顧客說」→ 按鈕。
 */
import React from 'react';
import { Ban, CalendarX, SearchX, Smartphone, Ticket, UserX, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultAction, ResultView } from './outcomes';
import { Button, DetailList, Page, TopBar } from './ui';

const ICONS: Record<ResultView['icon'], React.ComponentType<{ className?: string }>> = {
  ticket: Ticket,
  ban: Ban,
  calendar: CalendarX,
  search: SearchX,
  phone: Smartphone,
  wifi: WifiOff,
  account: UserX,
};

const TONE = {
  success: { card: 'bg-success-subtle', icon: 'bg-success text-success-foreground', category: 'text-success' },
  danger: { card: 'bg-destructive-subtle', icon: 'bg-destructive text-destructive-foreground', category: 'text-destructive' },
  neutral: { card: 'bg-warning-subtle', icon: 'bg-warning text-warning-foreground', category: 'text-warning' },
} as const;

export function ResultScreen({ view, onAction }: { view: ResultView; onAction: (action: ResultAction) => void }) {
  const Icon = ICONS[view.icon];
  const tone = TONE[view.tone];
  const primaryFirst = view.actions.length > 1 && view.actions[0].variant === 'primary';
  return (
    <Page className="bg-background">
      <TopBar title="核銷結果" />
      <div className="bg-muted px-5 py-6">
        <section
          role={view.tone === 'success' ? 'status' : 'alert'}
          className={cn('rounded-2xl p-5 shadow-sm', tone.card)}
        >
          <div className="flex items-center gap-4">
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', tone.icon)}>
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className={cn('text-[15px] font-bold', tone.category)}>{view.category}</p>
              <h2 className="mt-0.5 break-words text-2xl font-bold leading-tight text-foreground">{view.title}</h2>
            </div>
          </div>
          {(view.description || view.kv) && (
            <div className="mt-4 border-t border-foreground/10 pt-3">
              {view.kv ? (
                <div className="flex items-center justify-between gap-3 text-base">
                  <span className="text-muted-foreground">{view.kv.k}</span>
                  <span className="font-mono font-bold text-foreground">{view.kv.v}</span>
                </div>
              ) : (
                <p className="text-base text-muted-foreground">{view.description}</p>
              )}
            </div>
          )}
          {view.tag && (
            <span className="mt-3 inline-block rounded-full bg-background px-3 py-1.5 text-sm font-bold text-foreground">
              {view.tag}
            </span>
          )}
        </section>
      </div>

      <main className="flex flex-1 flex-col px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-5">
        {(view.rows.length > 0 || view.bigCode) && <h3 className="text-base font-bold text-foreground">核銷明細</h3>}
        {view.bigCode && (
          <div className="mt-3 rounded-xl bg-muted px-4 py-3">
            <p className="text-sm text-muted-foreground">查詢的序號</p>
            <p className="mt-1 break-all font-mono text-2xl font-bold tracking-wider text-foreground">{view.bigCode}</p>
          </div>
        )}
        <DetailList rows={view.rows} className="mt-1" />

        <div className="mt-auto space-y-3 pt-8">
          {view.say && (
            <figure className="rounded-xl border-l-4 border-muted-foreground/40 bg-muted px-4 py-3">
              <figcaption className="text-sm text-muted-foreground">可以這樣跟顧客說</figcaption>
              <blockquote className="mt-1 text-base leading-7 text-foreground">{`「${view.say}」`}</blockquote>
            </figure>
          )}
          <div className={cn('gap-3', view.actions.length > 1 && !primaryFirst ? 'grid grid-cols-2' : 'flex flex-col')}>
            {view.actions.map((a) => (
              <Button key={a.action} variant={a.variant} onClick={() => onAction(a.action)}>
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      </main>
    </Page>
  );
}
