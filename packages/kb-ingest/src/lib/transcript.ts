/**
 * 逐字稿解析 + 檔名解析 + 型號偵測。
 *
 * 型號偵測邏輯刻意「複製自」apps/api 的 model-matcher.ts（純字串函式），
 * 讓 kb-ingest 只依賴 @open333crm/database，不拉整條 apps/api 依賴鏈。
 * 若 apps/api 的正則更新，需同步此處（正則保持一致）。
 */
import { basename } from 'node:path';
import type { Turn } from './types.js';

// ─── 逐字稿內容解析 ──────────────────────────────────────────────────────────

/**
 * 解析一行 `[002.96s - 005.91s] [客服] 內容`。
 * 解析不出時間戳或角色的行回傳 null（例如空行）。
 */
const LINE_PATTERN = /^\[\s*(\d+(?:\.\d+)?)s\s*-\s*\d+(?:\.\d+)?s\s*\]\s*\[(客服|客戶)\]\s*(.*)$/;

export function parseTranscript(raw: string): Turn[] {
  const turns: Turn[] = [];
  // 逐字稿為 CRLF 行尾，先正規化掉 \r，否則 $ 錨點會匹配失敗。
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const m = line.match(LINE_PATTERN);
    if (!m) continue;
    const text = m[3].trim();
    if (!text) continue;
    turns.push({
      role: m[2] as '客服' | '客戶',
      text,
      startSec: parseFloat(m[1]),
    });
  }
  return turns;
}

/** 把逐句對話還原成一段純文字（供 LLM / 關鍵詞比對用）。 */
export function turnsToText(turns: Turn[]): string {
  return turns.map((t) => `[${t.role}] ${t.text}`).join('\n');
}

/** 只取客戶說的話（供問題分布統計用）。 */
export function customerText(turns: Turn[]): string {
  return turns
    .filter((t) => t.role === '客戶')
    .map((t) => t.text)
    .join('\n');
}

// ─── 檔名解析 ────────────────────────────────────────────────────────────────

/**
 * 解析檔名 `ultra{7碼座席}{YYYYMMDD}{HHMMSS}.txt`。
 * 例：ultra155200420260512085310.txt
 *   → seat=1552004, date=2026-05-12, time=08:53:10
 */
export function parseFilename(path: string): {
  seat: string;
  date: string;
  time: string;
} {
  const name = basename(path).replace(/\.txt$/i, '');
  const m = name.match(/^ultra(\d{7})(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) {
    return { seat: 'unknown', date: 'unknown', time: 'unknown' };
  }
  const [, seat, y, mo, d, h, mi, s] = m;
  return {
    seat,
    date: `${y}-${mo}-${d}`,
    time: `${h}:${mi}:${s}`,
  };
}

// ─── 型號偵測（複製自 apps/api/src/modules/ai/model-matcher.ts）─────────────────

const MODEL_PATTERN = /\b([A-Z]{1,4})-([0-9A-Z]+(?:-[0-9A-Z]+)*)\b/gi;

/**
 * 型號偵測停用詞：逐字稿口語（ASR）會誤觸正則的常見英文詞，非產品型號。
 * 比對「完整 raw」與「前綴」兩層，命中即排除。
 */
const MODEL_STOPWORDS = new Set([
  'WI-FI', 'E-MAIL', 'HDMI-2', 'USB-C', 'TYPE-C', 'CD-R', 'DVD-R',
]);
const MODEL_STOP_PREFIX = new Set(['WI', 'E']);

export interface ParsedModel {
  raw: string;
  prefix: string;
  firstSegment: string;
  key: string;
  capacity: string | null;
}

function extractCapacityDigits(firstSegment: string): string | null {
  const m = firstSegment.match(/^(\d+)/);
  return m ? m[1] : null;
}

/** 從文字偵測所有型號 pattern（去重、保留出現順序）。 */
export function detectModels(text: string): ParsedModel[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: ParsedModel[] = [];
  const re = new RegExp(MODEL_PATTERN.source, 'gi');
  for (const match of text.matchAll(re)) {
    const prefix = match[1].toUpperCase();
    const rest = match[2].toUpperCase();
    const firstSegment = rest.split('-')[0];
    const raw = `${prefix}-${rest}`;
    if (MODEL_STOPWORDS.has(raw) || MODEL_STOP_PREFIX.has(prefix)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push({
      raw,
      prefix,
      firstSegment,
      key: `${prefix}-${firstSegment}`,
      capacity: extractCapacityDigits(firstSegment),
    });
  }
  return out;
}

/** 便利函式：回傳去重後的型號主鍵陣列。 */
export function detectModelKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const m of detectModels(text)) keys.add(m.key);
  return [...keys];
}
