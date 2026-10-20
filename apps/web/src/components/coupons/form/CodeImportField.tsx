'use client';

/**
 * 序號包匯入（規格 2.2 第 4 區）：CSV，單欄一行一碼，上限 50,000 筆，格式 ^[A-Za-z0-9-]{4,32}$。
 *
 * 後端的檢查端點掛在券底下（POST /coupons/:id/codes/preview），所以還沒有券 id 時，
 * 先由 ensureCouponId() 自動儲存草稿取得 id，再請後端比對「與其他券的序號重複」。
 * 檔內的格式錯誤與重複在前端就能判斷，並保留行號供「下載錯誤清單」。
 * 真正寫入序號（importCodes）在發布前才做，見 CouponForm。
 */
import React, { useRef } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewCodeImport } from '@/hooks/useCoupons';
import { getApiErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { IMPORT_CODE_PATTERN, MAX_IMPORT_CODES } from './form-model';

export interface ImportState {
  status: 'idle' | 'checking' | 'done' | 'error';
  fileName?: string;
  message?: string;
  /** 可匯入的序號（已排除格式錯誤、檔內重複、與其他券重複） */
  codes: string[];
  dup: number;
  bad: number;
  /** 錯誤清單的資料列：行號,序號,原因 */
  errorRows: string[];
  /** 已寫入後端（發布前匯入成功後為 true，避免重試時重複匯入） */
  imported: boolean;
}

export const EMPTY_IMPORT: ImportState = { status: 'idle', codes: [], dup: 0, bad: 0, errorRows: [], imported: false };

interface Props {
  id: string;
  state: ImportState;
  onChange: (next: ImportState) => void;
  /** 取得券 id；還沒有時自動儲存草稿。失敗回傳 null（呼叫端負責顯示原因）。 */
  ensureCouponId: () => Promise<string | null>;
  missing?: boolean;
  warn?: string;
}

/** CSV 欄位可能被引號包住，也可能有 BOM；只取每行第一欄。 */
function cellOf(line: string): string {
  const first = line.split(',')[0] ?? '';
  return first.trim().replace(/^"(.*)"$/, '$1').trim();
}

export function CodeImportField({ id, state, onChange, ensureCouponId, missing, warn }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!/\.csv$/i.test(file.name)) {
      onChange({ ...EMPTY_IMPORT, status: 'error', message: '格式不支援，請上傳 .csv 檔' });
      return;
    }
    onChange({ ...EMPTY_IMPORT, status: 'checking', fileName: file.name });
    let text: string;
    try {
      text = await file.text();
    } catch {
      onChange({ ...EMPTY_IMPORT, status: 'error', fileName: file.name, message: '無法讀取檔案，請重新上傳' });
      return;
    }
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const rows = lines.map((l, i) => ({ line: i + 1, code: cellOf(l) })).filter((r) => r.code !== '');
    if (rows.length > MAX_IMPORT_CODES) {
      onChange({
        ...EMPTY_IMPORT,
        status: 'error',
        fileName: file.name,
        message: `共 ${rows.length.toLocaleString('en-US')} 筆，超過上限 50,000 筆，請分批匯入`,
      });
      return;
    }

    const seen = new Set<string>();
    const ok: { line: number; code: string }[] = [];
    const errorRows: string[] = [];
    let dup = 0;
    let bad = 0;
    for (const r of rows) {
      // 後端以大寫保存，大小寫不同視為同一組
      const code = r.code.toUpperCase();
      if (!IMPORT_CODE_PATTERN.test(r.code)) {
        bad++;
        errorRows.push(`${r.line},${r.code},格式錯誤`);
      } else if (seen.has(code)) {
        dup++;
        errorRows.push(`${r.line},${r.code},重複`);
      } else {
        seen.add(code);
        ok.push({ line: r.line, code });
      }
    }

    const couponId = await ensureCouponId();
    if (!couponId) {
      onChange({ ...EMPTY_IMPORT, status: 'error', fileName: file.name, message: '需要先儲存草稿才能檢查序號，請修正後重新上傳' });
      return;
    }
    try {
      const preview = (await previewCodeImport(couponId, ok.map((r) => r.code).join('\n'))) as { conflicts?: string[] };
      const conflicts = new Set((preview?.conflicts ?? []).map((c) => c.toUpperCase()));
      const codes: string[] = [];
      for (const r of ok) {
        if (conflicts.has(r.code)) {
          dup++;
          errorRows.push(`${r.line},${r.code},與其他券的序號重複`);
        } else {
          codes.push(r.code);
        }
      }
      errorRows.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));
      onChange({ status: 'done', fileName: file.name, codes, dup, bad, errorRows, imported: false });
    } catch (err) {
      onChange({ ...EMPTY_IMPORT, status: 'error', fileName: file.name, message: getApiErrorMessage(err, '檢查序號失敗，請重新上傳') });
    }
  };

  const downloadErrors = () => {
    const blob = new Blob([`﻿行號,序號,原因\n${state.errorRows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '序號錯誤清單.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const fmt = (n: number) => n.toLocaleString('en-US');
  const checking = state.status === 'checking';
  const error = state.status === 'error' ? state.message : '';

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-cell>
      <span id={`${id}-label`} className="text-sm font-medium text-foreground">
        序號包
        <span className="ml-1 text-destructive" aria-hidden="true">
          *
        </span>
      </span>
      {state.status === 'done' ? (
        <div className="flex flex-col gap-2 rounded-[10px] border bg-background px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-sm">{state.fileName}</span>
            <Button id={id} type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} aria-labelledby={`${id}-label ${id}`}>
              重新上傳
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" role="status">
            <span className="text-success">
              成功 <span className="font-mono">{fmt(state.codes.length)}</span> 筆
            </span>
            <span className={state.dup ? 'text-warning' : 'text-muted-foreground'}>
              重複 <span className="font-mono">{fmt(state.dup)}</span> 筆
            </span>
            <span className={state.bad ? 'text-destructive' : 'text-muted-foreground'}>
              格式錯誤 <span className="font-mono">{fmt(state.bad)}</span> 筆
            </span>
          </div>
          {state.errorRows.length > 0 && (
            <button type="button" onClick={downloadErrors} className="self-start text-sm font-medium text-primary underline-offset-2 hover:underline">
              下載錯誤清單
            </button>
          )}
        </div>
      ) : (
        <button
          id={id}
          type="button"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help${error || missing ? ` ${id}-err` : ''}`}
          disabled={checking}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex h-11 items-center gap-2.5 rounded-[10px] border border-dashed bg-background px-4 text-sm font-medium text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait',
            error || missing ? 'border-destructive' : 'border-muted-foreground/40',
          )}
        >
          <FileUp className="h-4 w-4" aria-hidden="true" />
          {checking ? (
            <span role="status">上傳中，正在檢查序號… {state.fileName}</span>
          ) : (
            '選擇 CSV 檔上傳'
          )}
        </button>
      )}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        CSV · 單欄一行一碼 · 上限 50,000 筆
      </p>
      {warn && state.status === 'done' && <p className="text-xs text-warning">{warn}</p>}
      {(error || (missing && state.status !== 'done')) && (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error || '此欄位必填'}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
