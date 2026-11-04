/**
 * CSV 儲存格跳脫（#423、ANA-03，change fix-csv-export-escaping）。
 * 所有 CSV 匯出（報表、優惠券序號明細、資料匯出）共用這個函式。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { csvCell, csvRow } from '#src/utils/csv.js';

/** 依 RFC 4180 拆一列，用來數欄數 */
function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

test('含逗號、雙引號、換行的值以雙引號包住，引號加倍', () => {
  assert.equal(csvCell('王, 小美'), '"王, 小美"');
  assert.equal(csvCell('說"你好"'), '"說""你好"""');
  assert.equal(csvCell('第一行\n第二行'), '"第一行\n第二行"');
  assert.equal(csvCell('a\r\nb'), '"a\r\nb"');
});

test('一般值照原樣輸出，null 與 undefined 是空欄', () => {
  assert.equal(csvCell('王小美'), '王小美');
  assert.equal(csvCell('2026-10-21T03:00:00.000Z'), '2026-10-21T03:00:00.000Z');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('以 = + - @ Tab CR 開頭的文字加單引號，Excel 不會當成公式', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+886912345678'), "'+886912345678");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\t=1'), "'\t=1");
  assert.equal(csvCell('\r=1'), `"'\r=1"`);
});

test('公式開頭又含逗號與引號的暱稱：加單引號、包引號，欄數不變', () => {
  const name = '=HYPERLINK("http://evil.example","hc-analytics, 點我")';
  const cell = csvCell(name);
  assert.equal(cell, `"'=HYPERLINK(""http://evil.example"",""hc-analytics, 點我"")"`);
  const fields = parseRow(csvRow(['id-1', name, 3]));
  assert.equal(fields.length, 3);
  assert.equal(fields[1], `'${name}`);
});

test('數字欄位（含負數、小數）不加單引號', () => {
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(-0.5), '-0.5');
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(12n), '12');
  assert.equal(csvCell(-3n), '-3');
  assert.equal(csvCell(true), 'true');
});

test('日期輸出 ISO 字串，物件輸出 JSON', () => {
  assert.equal(csvCell(new Date('2026-11-04T00:00:00.000Z')), '2026-11-04T00:00:00.000Z');
  assert.equal(csvCell({ a: 1, b: 'x' }), '"{""a"":1,""b"":""x""}"');
});

test('csvRow 以逗號串接每一欄', () => {
  assert.equal(csvRow(['ID', '標題, 副標', -1, null]), 'ID,"標題, 副標",-1,');
});
