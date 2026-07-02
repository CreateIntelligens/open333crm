/**
 * JSONL 讀寫工具（階段間串接用）＋ 簡易 CSV 輸出。
 */
import {
  appendFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';

/** 逐行讀 JSONL，解析成物件陣列（空檔回 []）。 */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

/** 覆寫整個 JSONL 檔。 */
export function writeJsonl<T>(path: string, rows: T[]): void {
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(path, body ? body + '\n' : '', 'utf8');
}

/** 追加一筆到 JSONL（斷點續跑用）。 */
export function appendJsonl<T>(path: string, row: T): void {
  appendFileSync(path, JSON.stringify(row) + '\n', 'utf8');
}

/** 讀進度檔（已完成的檔名集合）。 */
export function readProgress(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

/** 追加一筆進度。 */
export function appendProgress(path: string, id: string): void {
  appendFileSync(path, id + '\n', 'utf8');
}

/** 將一個 CSV 欄位值加上引號跳脫（含逗號/引號/換行時）。 */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 把物件陣列寫成 CSV（第一列為表頭）。 */
export function writeCsv(
  path: string,
  headers: string[],
  rows: Record<string, unknown>[],
): void {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  // 前綴 BOM，Excel 開繁中不亂碼
  writeFileSync(path, '﻿' + lines.join('\n') + '\n', 'utf8');
}
