/**
 * 券碼產生與驗證。
 *
 * 券碼會被店員口頭覆述、手動輸入，因此避開易混淆字元（0/O、1/I/L）——
 * 這是設計決策不是實作細節，改動會讓既有券碼與新券碼的字集不一致。
 */
import { randomInt } from 'node:crypto';

/** 去除 0/O/1/I/L 的字集，避免人工輸入誤判。 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_CODE_LENGTH = 10;

/** 前綴僅允許英數，長度上限 8——過長會擠壓亂數部分、降低碰撞空間。 */
const PREFIX_RE = /^[A-Z0-9]{1,8}$/;

export function normalizePrefix(prefix: string | null | undefined): string {
  if (!prefix) return '';
  const upper = prefix.trim().toUpperCase();
  if (!upper) return '';
  if (!PREFIX_RE.test(upper)) {
    throw new Error('券碼前綴僅能為 1-8 碼英數字');
  }
  return upper;
}

/**
 * 產生一組隨機券碼。用 randomInt（CSPRNG）而非 Math.random——
 * 券碼可被猜中即等同可被冒用。
 */
export function generateCouponCode(prefix?: string | null, length = DEFAULT_CODE_LENGTH): string {
  const p = normalizePrefix(prefix);
  let body = '';
  for (let i = 0; i < length; i += 1) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return p ? `${p}-${body}` : body;
}

/** 匯入的券碼統一轉大寫去空白，讓比對與唯一約束一致。 */
export function normalizeImportedCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export interface ParsedCodeList {
  valid: string[];
  /** 同一批匯入內部的重複，直接略過不報錯 */
  duplicatesInInput: string[];
  /** 格式不合者，需回報讓使用者修正 */
  invalid: string[];
}

/**
 * 解析貼上或上傳的券碼清單。支援換行、逗號、分號、tab 分隔。
 * 不在此檢查與 DB 既有券碼的衝突——那需要查庫，屬 service 層職責。
 */
export function parseCodeList(input: string): ParsedCodeList {
  const seen = new Set<string>();
  const valid: string[] = [];
  const duplicatesInInput: string[] = [];
  const invalid: string[] = [];

  for (const token of input.split(/[\s,;]+/)) {
    const code = normalizeImportedCode(token);
    if (!code) continue;
    // 允許英數與連字號，長度 4-64——比產生器寬鬆，因為商家可能匯入既有系統的券碼
    if (!/^[A-Z0-9-]{4,64}$/.test(code)) {
      invalid.push(code);
      continue;
    }
    if (seen.has(code)) {
      duplicatesInInput.push(code);
      continue;
    }
    seen.add(code);
    valid.push(code);
  }

  return { valid, duplicatesInInput, invalid };
}
