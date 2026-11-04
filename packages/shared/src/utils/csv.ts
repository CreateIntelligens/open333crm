/**
 * CSV 儲存格跳脫（#423、ANA-03）。所有 CSV 匯出共用：報表匯出（analytics）、優惠券序號明細、
 * 租戶資料匯出（workers）。web 會 bundle 這個套件，這裡不可 import Node-only 模組。
 */

/** Excel 會把以這些字元開頭的文字當成公式（OWASP CSV injection） */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** 含這些字元的欄位要以雙引號包住（RFC 4180） */
const NEEDS_QUOTE = /[",\r\n]/;

/**
 * 把一個值轉成 CSV 儲存格。
 * - `null`／`undefined` 是空欄。
 * - 數字、bigint、布林照原樣輸出：負數不加單引號，Excel 仍當成數字。
 * - `Date` 輸出 ISO 字串；其他物件輸出 JSON。
 * - 文字以 `=`、`+`、`-`、`@`、Tab、CR 開頭時前面加 `'`，Excel 當成文字而非公式
 *   （聯絡人名稱來自顧客自訂的 LINE／FB 暱稱或 WebChat 訪客自填）。
 * - 含逗號、雙引號、換行時以雙引號包住，內部的 `"` 改成 `""`。
 */
export function csvCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);

  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return NEEDS_QUOTE.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 一列 CSV：每一欄經過 `csvCell()` 後以逗號串接（標題列也用它） */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',');
}
