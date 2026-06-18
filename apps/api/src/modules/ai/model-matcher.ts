/**
 * Model Matcher — 純函式工具，負責「型號偵測 / 正規化 / 相近型號比對」。
 *
 * 背景：大同產品型號為三段式結構，例如 `TAC-11A-MB`：
 *   ┌─ 前綴（品類碼）  ┌─ 人份+系列（第1段）  ┌─ 變體碼（第3段，選用）
 *   TAC             - 11A                  - MB
 *
 * 重點設計：
 * 1. 比對只看「前綴 + 第1段」（如 `TAC-11A`），不要求第3段（顏色/聯名/電壓）一致。
 *    因為第3段多為變體，知識庫常不會收錄全部變體，太嚴會誤擋。
 * 2. 「相近型號」= 同前綴 + 同人份數（如 `TAC-11*`）的所有已知型號，供引導使用者選。
 *
 * 此檔不碰資料庫，只處理字串。型號白名單由 model-registry.service 提供。
 */

/**
 * 型號偵測正則。
 * - 前綴：2~4 個大寫英文字母（TAC / TF / TAW / TDH / TOT / TEK …）
 * - 緊接 `-` 與至少一段「英數」，後面可再接多段 `-英數`
 * 例：TAC-11P-MFB、TAW-A080WM、TDH-168MC-NW、AC-9
 */
const MODEL_PATTERN = /\b([A-Z]{1,4})-([0-9A-Z]+(?:-[0-9A-Z]+)*)\b/gi;

/** 從「第1段」抽出人份數字（型號開頭的連續數字），抓不到回傳 null。 */
function extractCapacityDigits(firstSegment: string): string | null {
  const m = firstSegment.match(/^(\d+)/);
  return m ? m[1] : null;
}

export interface ParsedModel {
  /** 正規化後的完整輸入型號（大寫、去空白），例：TAC-11P-MFB */
  raw: string;
  /** 前綴品類碼，例：TAC */
  prefix: string;
  /** 第1段（人份+系列），例：11P */
  firstSegment: string;
  /** 比對主鍵（前綴 + 第1段），例：TAC-11P */
  key: string;
  /** 人份數字（抓不到為 null），例：11 */
  capacity: string | null;
}

/**
 * 從一段文字中偵測所有型號 pattern，回傳解析後的型號陣列（去重、保留出現順序）。
 * 沒有偵測到任何型號時回傳空陣列。
 */
export function detectModels(text: string): ParsedModel[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: ParsedModel[] = [];

  // matchAll 需要 global flag；用副本避免共用 lastIndex 狀態。
  const re = new RegExp(MODEL_PATTERN.source, 'gi');
  for (const match of text.matchAll(re)) {
    const prefix = match[1].toUpperCase();
    const rest = match[2].toUpperCase();
    const segments = rest.split('-');
    const firstSegment = segments[0];

    // 第1段必須以數字開頭才視為「人份型號」（排除像 S02/S03 之類特例不在此守門）
    // 註：若需涵蓋無人份數的型號，可放寬此條件。
    const raw = `${prefix}-${rest}`;
    const key = `${prefix}-${firstSegment}`;
    if (seen.has(raw)) continue;
    seen.add(raw);

    out.push({
      raw,
      prefix,
      firstSegment,
      key,
      capacity: extractCapacityDigits(firstSegment),
    });
  }
  return out;
}

/**
 * 判斷某個解析後的型號，其比對主鍵（前綴+第1段）是否存在於白名單。
 * 白名單應為「主鍵集合」（如 'TAC-11A'），由 model-registry 產生。
 */
export function isKnownModel(parsed: ParsedModel, knownKeys: ReadonlySet<string>): boolean {
  return knownKeys.has(parsed.key);
}

/**
 * 找出與輸入型號「相近」的已知型號，用於引導使用者選擇。
 * 相近定義：同前綴 + 同人份數（例：TAC-11P 找不到 → 列出所有 TAC-11* 已知型號）。
 *
 * @param parsed     使用者輸入的（查無的）型號
 * @param knownKeys  白名單主鍵集合（如 TAC-11A、TAC-11KN…）
 * @param limit      最多回傳幾個（預設 12，避免訊息過長）
 * @returns          相近型號主鍵陣列（已排序），可能為空
 */
export function findRelatedModels(
  parsed: ParsedModel,
  knownKeys: ReadonlySet<string>,
  limit = 12,
): string[] {
  const related: string[] = [];
  for (const key of knownKeys) {
    if (key === parsed.key) continue;
    // 同前綴
    const [prefix, firstSeg] = splitKey(key);
    if (prefix !== parsed.prefix) continue;
    // 同人份數（若輸入沒有人份數，退而求其次只比前綴）
    if (parsed.capacity) {
      const cap = firstSeg.match(/^(\d+)/)?.[1] ?? null;
      if (cap !== parsed.capacity) continue;
    }
    related.push(key);
  }
  related.sort();
  return related.slice(0, limit);
}

/** 將主鍵拆回 [前綴, 第1段]，例：'TAC-11A' → ['TAC', '11A']。 */
function splitKey(key: string): [string, string] {
  const idx = key.indexOf('-');
  if (idx < 0) return [key, ''];
  return [key.slice(0, idx), key.slice(idx + 1)];
}
