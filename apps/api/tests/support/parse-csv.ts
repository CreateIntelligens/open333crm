/**
 * 測試用的 CSV 解析（RFC 4180：雙引號內可含逗號、換行，`""` 是一個引號）。
 * 用來確認匯出的 CSV 每列欄數正確（#423）。開頭的 BOM 由呼叫端先去掉。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}
