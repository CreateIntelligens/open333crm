'use client';

/**
 * 核銷台主畫面（mobile-prototype-spec 2.4）：頂部門市名稱（點開選單可登出）、「紀錄 N」膠囊鈕，
 * 分頁「掃描核銷」「手動核銷」。掃描分頁整頁深色（相機取景），手動分頁跟隨主題。
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ManualPanel } from './ManualPanel';
import { ScanPanel, type LastScan } from './ScanPanel';
import { Button } from './ui';

export type Tab = 'scan' | 'manual';

interface Props {
  storeName: string;
  username: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  recordCount: number | null;
  onRecords: () => void;
  onLogout: () => void;
  manualValue: string;
  onManualChange: (value: string) => void;
  onLookup: (code: string, from: Tab) => void;
  lookingUp: boolean;
  lookupError: string | null;
  lastScanRef: React.MutableRefObject<LastScan | null>;
}

export function MainScreen(props: Props) {
  const { storeName, username, tab, onTab, recordCount, onRecords, onLogout, lookingUp, lookupError } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const dark = tab === 'scan';

  return (
    <div className={cn('flex min-h-[100dvh] justify-center', dark ? 'bg-[#0B0E12]' : 'bg-background')}>
      <div className="flex min-h-[100dvh] w-full max-w-[480px] flex-col">
        <header className={cn('px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]', dark ? 'text-white' : 'text-foreground')}>
          <div className="flex h-14 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className="-ml-1 flex min-w-0 items-center gap-1 rounded-lg px-1 py-2 text-left text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{storeName}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onRecords}
              aria-label={recordCount != null ? `紀錄 ${recordCount}` : '紀錄'}
              className={cn(
                'flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                dark ? 'border-white/30 text-white' : 'border-border text-foreground',
              )}
            >
              <span>紀錄</span>
              {recordCount != null && <span className="tabular-nums">{recordCount}</span>}
            </button>
          </div>
          <div
            role="tablist"
            aria-label="核銷方式"
            className={cn('mt-1 grid grid-cols-2 gap-1 rounded-xl p-1', dark ? 'bg-white/10' : 'bg-muted')}
          >
            {(
              [
                ['scan', '掃描核銷'],
                ['manual', '手動核銷'],
              ] as const
            ).map(([key, label]) => {
              const selected = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`store-tab-${key}`}
                  aria-selected={selected}
                  aria-controls={`store-panel-${key}`}
                  onClick={() => onTab(key)}
                  className={cn(
                    'h-11 rounded-lg text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? dark
                        ? 'bg-white text-[#11161D]'
                        : 'bg-background text-foreground shadow-sm'
                      : dark
                        ? 'text-white/60'
                        : 'text-muted-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </header>

        <div role="tabpanel" id={`store-panel-${tab}`} aria-labelledby={`store-tab-${tab}`} className="flex flex-1 flex-col">
          {tab === 'scan' ? (
            <ScanPanel
              busy={lookingUp}
              lastScanRef={props.lastScanRef}
              onDetected={(code) => props.onLookup(code, 'scan')}
              onManual={() => onTab('manual')}
              error={lookupError}
            />
          ) : (
            <ManualPanel
              value={props.manualValue}
              onChange={props.onManualChange}
              onSubmit={(code) => props.onLookup(code, 'manual')}
              busy={lookingUp}
              error={lookupError}
            />
          )}
        </div>
      </div>

      {menuOpen && (
        <StoreMenu
          storeName={storeName}
          username={username}
          onClose={() => setMenuOpen(false)}
          onLogout={() => {
            setMenuOpen(false);
            onLogout();
          }}
        />
      )}
    </div>
  );
}

/** 底部彈出的門市選單：目前登入的門市與帳號、登出 */
function StoreMenu({
  storeName,
  username,
  onClose,
  onLogout,
}: {
  storeName: string;
  username: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div aria-hidden className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-menu-title"
        tabIndex={-1}
        className="relative w-full max-w-[480px] rounded-t-2xl bg-background px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 text-foreground focus:outline-none"
      >
        <p id="store-menu-title" className="text-sm font-medium text-muted-foreground">
          目前登入
        </p>
        <p className="mt-1 text-lg font-bold">{storeName}</p>
        <p className="mt-1 text-sm text-muted-foreground">門市帳號 {username}</p>
        <div className="mt-6 space-y-3">
          <Button onClick={onLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            登出
          </Button>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
