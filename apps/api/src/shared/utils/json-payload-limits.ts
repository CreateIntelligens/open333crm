/**
 * JSON 請求內容的大小上限（change limit-request-array-size，spec request-payload-limits，issue #382）。
 *
 * `zod/v3` 對陣列與 `z.record()` 的每個不合格項目各產生一筆錯誤，數量沒有上限，`.max()` 也擋不住
 * （GHSA-mrhx-c7xc-m3w5，Zod 4.6.6 只修了 v4 API）。這裡在 `JSON.parse` 之前掃描原始文字：
 * 只做字元比較，不建立物件、不遞迴，深度再大也不會堆疊溢位。
 *
 * 掃描不驗證 JSON 語法；格式錯誤的內容交給後面的 JSON 解析器回錯。
 */
import { AppError } from './response.js';

export interface JsonPayloadLimits {
  /** 單一陣列的元素數上限 */
  maxArrayLength: number;
  /** 單一物件的欄位數上限（`z.record()` 有同樣的放大問題） */
  maxObjectKeys: number;
  /** 整個請求的陣列元素與物件欄位總數上限 */
  maxTotalEntries: number;
  /** 陣列與物件的巢狀深度上限 */
  maxDepth: number;
}

export const DEFAULT_JSON_PAYLOAD_LIMITS: Readonly<JsonPayloadLimits> = Object.freeze({
  maxArrayLength: 10_000,
  maxObjectKeys: 10_000,
  maxTotalEntries: 100_000,
  maxDepth: 64,
});

export type JsonPayloadViolationKind = 'array' | 'object' | 'total' | 'depth';

export interface JsonPayloadViolation {
  kind: JsonPayloadViolationKind;
  /** 以 `.` 連接的位置，格式與 Zod 的 `issue.path.join('.')` 相同；根層是空字串 */
  path: string;
  limit: number;
}

interface Frame {
  isArray: boolean;
  /** 陣列的元素數，或物件的欄位數 */
  count: number;
  /** 陣列：下一個字元若是值，就是新的元素。物件：下一個字串是欄位名稱 */
  expectEntry: boolean;
  /** 物件目前欄位名稱在原文中的位置（含引號），只在需要回報位置時才解碼 */
  keyStart: number;
  keyEnd: number;
}

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \
const COMMA = 0x2c; // ,
const OPEN_BRACKET = 0x5b; // [
const CLOSE_BRACKET = 0x5d; // ]
const OPEN_BRACE = 0x7b; // {
const CLOSE_BRACE = 0x7d; // }

/** 陣列裡一個值的開頭字元：字串、陣列、物件、數字、true、false、null */
function isValueStart(c: number): boolean {
  return (
    c === QUOTE ||
    c === OPEN_BRACKET ||
    c === OPEN_BRACE ||
    c === 0x2d || // -
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x74 || // t
    c === 0x66 || // f
    c === 0x6e // n
  );
}

function decodeKey(text: string, frame: Frame): string {
  const raw = text.slice(frame.keyStart, frame.keyEnd + 1);
  try {
    const key = JSON.parse(raw);
    return typeof key === 'string' ? key : raw;
  } catch {
    return raw.slice(1, -1);
  }
}

/** 第 `depth` 層容器的位置：由第 0 層到第 depth-1 層各自目前的元素或欄位組成 */
function pathAt(text: string, stack: Frame[], depth: number): string {
  const segments: string[] = [];
  for (let i = 0; i < depth; i++) {
    const parent = stack[i];
    segments.push(parent.isArray ? String(parent.count - 1) : decodeKey(text, parent));
  }
  return segments.join('.');
}

/**
 * 掃描 JSON 原文，回傳第一個超過上限的地方；沒有超過時回傳 null。
 */
export function findJsonPayloadViolation(text: string, limits: JsonPayloadLimits): JsonPayloadViolation | null {
  const stack: Frame[] = [];
  const length = text.length;
  let total = 0;

  for (let i = 0; i < length; i++) {
    const c = text.charCodeAt(i);
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined;

    // 陣列裡的新元素（字串、數字、陣列、物件都算）
    if (top && top.isArray && top.expectEntry && isValueStart(c)) {
      top.expectEntry = false;
      top.count++;
      total++;
      if (top.count > limits.maxArrayLength) {
        return { kind: 'array', path: pathAt(text, stack, stack.length - 1), limit: limits.maxArrayLength };
      }
      if (total > limits.maxTotalEntries) {
        return { kind: 'total', path: pathAt(text, stack, stack.length - 1), limit: limits.maxTotalEntries };
      }
    }

    if (c === QUOTE) {
      const isKey = top !== undefined && !top.isArray && top.expectEntry;
      const start = i;
      // 跳過字串內容：字串裡的括號與逗號不計數
      i++;
      while (i < length) {
        const s = text.charCodeAt(i);
        if (s === BACKSLASH) {
          i += 2;
          continue;
        }
        if (s === QUOTE) break;
        i++;
      }
      if (isKey) {
        top.expectEntry = false;
        top.count++;
        total++;
        top.keyStart = start;
        top.keyEnd = i;
        if (top.count > limits.maxObjectKeys) {
          return { kind: 'object', path: pathAt(text, stack, stack.length - 1), limit: limits.maxObjectKeys };
        }
        if (total > limits.maxTotalEntries) {
          return { kind: 'total', path: pathAt(text, stack, stack.length - 1), limit: limits.maxTotalEntries };
        }
      }
      continue;
    }

    if (c === OPEN_BRACKET || c === OPEN_BRACE) {
      if (stack.length + 1 > limits.maxDepth) {
        return { kind: 'depth', path: pathAt(text, stack, stack.length), limit: limits.maxDepth };
      }
      stack.push({ isArray: c === OPEN_BRACKET, count: 0, expectEntry: true, keyStart: 0, keyEnd: 0 });
      continue;
    }

    if (c === CLOSE_BRACKET || c === CLOSE_BRACE) {
      stack.pop();
      continue;
    }

    if (c === COMMA && top) {
      top.expectEntry = true;
    }
  }

  return null;
}

const VIOLATION_ERRORS: Record<JsonPayloadViolationKind, { code: string; message: (v: JsonPayloadViolation) => string }> = {
  array: {
    code: 'PAYLOAD_ARRAY_TOO_LARGE',
    message: (v) => `${v.path ? `「${v.path}」的` : ''}陣列超過 ${v.limit} 筆上限，請分批送出`,
  },
  object: {
    code: 'PAYLOAD_OBJECT_TOO_LARGE',
    message: (v) => `${v.path ? `「${v.path}」的` : ''}欄位超過 ${v.limit} 個上限，請減少欄位後重新送出`,
  },
  total: {
    code: 'PAYLOAD_TOO_MANY_ENTRIES',
    message: (v) => `送出的資料超過 ${v.limit} 筆上限，請分批送出`,
  },
  depth: {
    code: 'PAYLOAD_TOO_DEEP',
    message: (v) => `送出的資料超過 ${v.limit} 層巢狀上限，請簡化資料結構`,
  },
};

/** 把違規內容轉成 400 的 AppError，`details` 帶位置與上限 */
export function jsonPayloadViolationError(violation: JsonPayloadViolation): AppError {
  const { code, message } = VIOLATION_ERRORS[violation.kind];
  return new AppError(message(violation), code, 400, { path: violation.path, limit: violation.limit });
}
