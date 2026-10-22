'use client';

/**
 * 手動核銷：輸入券上的序號（mobile-prototype-spec 2.5，依 design D13 調整）。
 * 只把輸入轉大寫顯示，不自動補連字號：後端比對時忽略連字號、空白與大小寫，
 * 原型依寫死的前綴清單補連字號，遇到未知前綴會永遠無法完成。
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button, ErrorNote } from './ui';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (code: string) => void;
  busy: boolean;
  error?: string | null;
}

export function ManualPanel({ value, onChange, onSubmit, busy, error }: Props) {
  const code = value.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code || busy) return;
    onSubmit(code);
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col bg-background px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-8">
      <label htmlFor="store-serial" className="text-base font-semibold text-foreground">
        輸入券上的序號
      </label>
      <input
        id="store-serial"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="例如 AUTUMN-7K2P4M9XQR"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="search"
        maxLength={64}
        aria-describedby="store-serial-help"
        className="mt-3 h-14 w-full rounded-xl border border-border bg-background px-4 font-mono text-lg tracking-wider text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p id="store-serial-help" className="mt-2 text-sm leading-6 text-muted-foreground">
        輸入顧客券上 QR Code 下方的序號，連字號可省略。
      </p>
      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
      <div className="mt-auto pt-8">
        <Button type="submit" disabled={!code || busy} aria-busy={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {busy ? '查詢中…' : '查詢'}
        </Button>
      </div>
    </form>
  );
}
