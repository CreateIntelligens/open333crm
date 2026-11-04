/**
 * 知識庫匯入 CSV 的文字編碼（issue #421，AUDIT KB-03，
 * spec km-ingestion「CSV import decodes UTF-8 and Big5 text」「CSV import rejects text that cannot be decoded」）。
 * Google 試算表、Numbers 與程式匯出的 CSV 沒有 BOM；台灣版 Excel 的「CSV（逗號分隔）」是 Big5。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseSpreadsheetToQaRows, parseFileToMarkdown } from '#src/modules/knowledge/file-parser.service.js';

const QA_ROW = { title: '退貨要幾天', content: '七天內可退貨' };

/** 「問題,答案\r\n退貨要幾天,七天內可退貨\r\n」的 Big5 位元組（以 Node 的 big5 解碼表反查產生） */
const BIG5_QA_CSV = Buffer.from(
  'b0ddc3442cb5aaaed70d0ab068b366ad6eb458a4d12ca443a4d1a4baa569b068b3660d0a',
  'hex',
);

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function utf8(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

test('CSV import decodes UTF-8 without BOM', () => {
  assert.deepEqual(parseSpreadsheetToQaRows(utf8('問題,答案\n退貨要幾天,七天內可退貨\n')), [QA_ROW]);
});

test('CSV import decodes UTF-8 with BOM', () => {
  const buffer = Buffer.concat([UTF8_BOM, utf8('問題,答案\n退貨要幾天,七天內可退貨\n')]);
  assert.deepEqual(parseSpreadsheetToQaRows(buffer), [QA_ROW]);
});

test('CSV import decodes Big5 from Taiwan Excel', () => {
  // 先確認常數不是合法 UTF-8，測的確實是 Big5 這條路
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(BIG5_QA_CSV));
  assert.deepEqual(parseSpreadsheetToQaRows(BIG5_QA_CSV), [QA_ROW]);
});

test('CSV import with English headers keeps Chinese content intact', () => {
  assert.deepEqual(parseSpreadsheetToQaRows(utf8('question,answer\n退貨要幾天,七天內可退貨\n')), [QA_ROW]);
});

test('CSV without QA headers is imported as one article with readable Chinese', async () => {
  const parsed = await parseFileToMarkdown(utf8('型號,說明\nTAC-11,冷氣\n'), 'text/csv', '型號表.csv');
  assert.equal(parsed.content.includes('| 型號 | 說明 |'), true, parsed.content);
  assert.equal(parsed.content.includes('| TAC-11 | 冷氣 |'), true, parsed.content);
});

test('CSV that cannot be decoded is rejected with a Chinese reason', () => {
  // 0x81 0x30 在 UTF-8 與 Big5 都不是合法字元
  const garbled = Buffer.concat([utf8('question,answer\n'), Buffer.from([0x81, 0x30, 0x2c, 0x81, 0x31, 0x0a])]);
  assert.throws(
    () => parseSpreadsheetToQaRows(garbled),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number; message?: string };
      assert.equal(e.code, 'CSV_ENCODING_UNREADABLE');
      assert.equal(e.statusCode, 400);
      assert.match(e.message ?? '', /UTF-8/);
      return true;
    },
  );
});

test('CSV that already contains replacement characters is rejected', () => {
  assert.throws(
    () => parseSpreadsheetToQaRows(utf8('question,answer\n退��,七天\n')),
    (err: unknown) => (err as { code?: string }).code === 'CSV_ENCODING_UNREADABLE',
  );
});
