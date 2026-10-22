/**
 * 序號包 CSV 解析（後台逐欄驗證 B7，2026-10-21）：標題列不是序號；
 * 去掉連字號後相同視為重複，與後端與核銷台的比對一致。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { codesTextFromWorkbook, parseCodeFile } from '#src/components/coupons/form/CodeImportField.js';

test('略過標題列、去掉連字號後相同視為重複', () => {
  const r = parseCodeFile('﻿code\nVAUI-0001\nvaui-0001\nVAUI0002\nVAUI-0002\nX\nAB-123456\n有中文\nVAUI-0003\n');
  assert.deepEqual(r.ok.map((x) => x.code), ['VAUI-0001', 'VAUI0002', 'AB-123456', 'VAUI-0003']);
  assert.equal(r.dup, 2);
  assert.equal(r.bad, 2);
  assert.ok(r.errorRows.includes('5,VAUI-0002,重複'));
});

test('沒有標題列時第一行是序號', () => {
  const r = parseCodeFile('ABCD-1234\nEFGH-5678');
  assert.deepEqual(r.ok.map((x) => x.code), ['ABCD-1234', 'EFGH-5678']);
});

test('只有連字號的序號視為格式錯誤', () => {
  const r = parseCodeFile('----\nABCD1234');
  assert.equal(r.bad, 1);
  assert.deepEqual(r.ok.map((x) => x.code), ['ABCD1234']);
});

test('管理者上傳 Excel 序號檔：取第一個工作表的 A 欄，行號對應 Excel 列號', async () => {
  const XLSX = await import('@e965/xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([['序號', '備註'], ['ABCD-1234', '第一批'], ['EFGH-5678'], [], ['X']]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '序號');
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const text = await codesTextFromWorkbook(buffer);
  const r = parseCodeFile(text);
  assert.deepEqual(r.ok.map((x) => x.code), ['ABCD-1234', 'EFGH-5678']);
  assert.equal(r.bad, 1);
  assert.deepEqual(r.errorRows, ['5,X,格式錯誤']);
});

test('Excel 數字格式的序號以原本的文字讀入', async () => {
  const XLSX = await import('@e965/xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([[12345678], ['00012345']]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'S');
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const r = parseCodeFile(await codesTextFromWorkbook(buffer));
  assert.deepEqual(r.ok.map((x) => x.code), ['12345678', '00012345']);
});
