'use client';

/**
 * 序號包匯入（規格 2.2 第 4 區）：CSV、Excel（.xlsx，第一個工作表的 A 欄）或直接貼上，一行一碼，
 * 上限 50,000 筆，格式 ^[A-Za-z0-9-]{4,32}$。
 *
 * 後端的檢查端點掛在券底下（POST /coupons/:id/codes/preview），所以還沒有券 id 時，
 * 先由 ensureCouponId() 自動儲存草稿取得 id，再請後端比對「與其他券的序號重複」。
 * 檔內的格式錯誤與重複在前端就能判斷，並保留行號供「下載錯誤清單」。
 * 真正寫入序號（importCodes）在發布前才做，見 CouponForm。
 */
import React, { useRef, useState } from 'react';
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

/** 序號的比對鍵：去掉連字號、轉大寫，與後端和核銷台一致（AB-1234 與 AB1234 視為同一組） */
const codeKey = (code: string) => code.replace(/-/g, '').toUpperCase();

/** 貼上序號時顯示在檔名位置的文字 */
const PASTED_NAME = '貼上的序號';

/** 第一行若是欄位名稱（code、序號、券號），不是序號 */
const HEADER_RE = /^(codes?|serials?|序號|券號|代碼)$/i;

export interface ParsedCodeFile {
  /** 檔案中的資料行數（不含空行與標題列） */
  total: number;
  ok: { line: number; code: string }[];
  dup: number;
  bad: number;
  /** 錯誤清單：行號,序號,原因 */
  errorRows: string[];
}

/** 解析序號 CSV：一行一碼，略過標題列；格式錯誤與檔內重複（去掉連字號後相同）各自記錄行號。 */
export function parseCodeFile(text: string): ParsedCodeFile {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let rows = lines.map((l, i) => ({ line: i + 1, code: cellOf(l) })).filter((r) => r.code !== '');
  if (rows.length > 0 && HEADER_RE.test(rows[0].code)) rows = rows.slice(1);

  const seen = new Set<string>();
  const ok: { line: number; code: string }[] = [];
  const errorRows: string[] = [];
  let dup = 0;
  let bad = 0;
  for (const r of rows) {
    const code = r.code.toUpperCase();
    // 至少 4 個英數字：只有連字號的序號去掉連字號後是空的，無法比對
    if (!IMPORT_CODE_PATTERN.test(r.code) || codeKey(code).length < 4) {
      bad++;
      errorRows.push(`${r.line},${r.code},格式錯誤`);
    } else if (seen.has(codeKey(code))) {
      dup++;
      errorRows.push(`${r.line},${r.code},重複`);
    } else {
      seen.add(codeKey(code));
      ok.push({ line: r.line, code });
    }
  }
  return { total: rows.length, ok, dup, bad, errorRows };
}

/**
 * Excel 檔轉成一行一碼的文字：取第一個工作表的 A 欄。行號對應 Excel 的列號，錯誤清單才對得上。
 * 數字格式的儲存格取顯示的文字（避免 00012345 變成 12345 或科學記號）。
 */
export async function codesTextFromWorkbook(data: ArrayBuffer): Promise<string> {
  const XLSX = await import('@e965/xlsx');
  const book = XLSX.read(data, { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet || !sheet['!ref']) return '';
  const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: true, defval: '' });
  // 用分隔字元以外的值當作一格：Excel 的值本身可能含逗號，交給 parseCodeFile 時只取第一欄
  const cells = rows.map((row) => String(row[0] ?? '').replace(/[,\r\n]/g, ' ').trim());
  return [...Array<string>(firstRow).fill(''), ...cells].join('\n');
}

/** CSV 欄位可能被引號包住，也可能有 BOM；只取每行第一欄。 */
function cellOf(line: string): string {
  const first = line.split(',')[0] ?? '';
  return first.trim().replace(/^"(.*)"$/, '$1').trim();
}

export function CodeImportField({ id, state, onChange, ensureCouponId, missing, warn }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState('');

  /** 解析、檢查與其他券重複；sourceName 是檔名或「貼上的序號」 */
  const processText = async (text: string, sourceName: string) => {
    const parsed = parseCodeFile(text);
    if (parsed.total > MAX_IMPORT_CODES) {
      onChange({
        ...EMPTY_IMPORT,
        status: 'error',
        fileName: sourceName,
        message: `共 ${parsed.total.toLocaleString('en-US')} 筆，超過上限 50,000 筆，請分批匯入`,
      });
      return;
    }
    const { ok, errorRows } = parsed;
    let { dup } = parsed;
    const { bad } = parsed;

    const couponId = await ensureCouponId();
    if (!couponId) {
      onChange({ ...EMPTY_IMPORT, status: 'error', fileName: sourceName, message: '需要先儲存草稿才能檢查序號，請修正後重新上傳' });
      return;
    }
    try {
      const preview = (await previewCodeImport(couponId, ok.map((r) => r.code).join('\n'))) as {
        conflicts?: string[];
        alreadyImported?: string[];
      };
      const conflicts = new Set((preview?.conflicts ?? []).map(codeKey));
      // 這張券自己已匯入的序號（草稿發布失敗後再上傳同一份檔）：不是衝突，也不再匯入一次
      const already = new Set((preview?.alreadyImported ?? []).map(codeKey));
      const codes: string[] = [];
      for (const r of ok) {
        if (already.has(codeKey(r.code))) {
          dup++;
          errorRows.push(`${r.line},${r.code},已在這張券的序號包`);
        } else if (conflicts.has(codeKey(r.code))) {
          dup++;
          errorRows.push(`${r.line},${r.code},與其他券的序號重複`);
        } else {
          codes.push(r.code);
        }
      }
      errorRows.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));
      onChange({ status: 'done', fileName: sourceName, codes, dup, bad, errorRows, imported: false });
    } catch (err) {
      onChange({ ...EMPTY_IMPORT, status: 'error', fileName: sourceName, message: getApiErrorMessage(err, '檢查序號失敗，請重新上傳') });
    }
  };

  const handleFile = async (file: File) => {
    const isCsv = /\.csv$/i.test(file.name);
    const isExcel = /\.xlsx$/i.test(file.name);
    if (!isCsv && !isExcel) {
      onChange({ ...EMPTY_IMPORT, status: 'error', message: '格式不支援，請上傳 .csv 或 .xlsx 檔，或直接貼上序號' });
      return;
    }
    setPasting(false);
    onChange({ ...EMPTY_IMPORT, status: 'checking', fileName: file.name });
    let text: string;
    try {
      text = isExcel ? await codesTextFromWorkbook(await file.arrayBuffer()) : await file.text();
    } catch {
      onChange({ ...EMPTY_IMPORT, status: 'error', fileName: file.name, message: '無法讀取檔案，請確認檔案沒有損壞後重新上傳' });
      return;
    }
    await processText(text, file.name);
  };

  const handlePaste = async () => {
    if (!pasted.trim()) {
      setPasteError('請貼上至少一組序號');
      return;
    }
    setPasteError('');
    onChange({ ...EMPTY_IMPORT, status: 'checking', fileName: PASTED_NAME });
    await processText(pasted, PASTED_NAME);
    setPasting(false);
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
      ) : pasting ? (
        <div className="flex flex-col gap-2 rounded-[10px] border bg-background p-3">
          <label htmlFor={`${id}-paste`} className="text-xs font-medium text-muted-foreground">
            貼上序號
          </label>
          <textarea
            id={`${id}-paste`}
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'ABCD-1234\nEFGH-5678'}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {pasteError && (
            <p className="text-xs text-destructive" role="alert">
              {pasteError}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={checking} onClick={() => void handlePaste()}>
              {checking ? '檢查中…' : '檢查序號'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={checking} onClick={() => setPasting(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
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
              '選擇 CSV 或 Excel 檔上傳'
            )}
          </button>
          {!checking && (
            <button
              type="button"
              onClick={() => setPasting(true)}
              className="self-start text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              直接貼上序號
            </button>
          )}
        </div>
      )}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        CSV 或 Excel（第一個工作表的 A 欄）· 一行一碼 · 上限 50,000 筆
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
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
