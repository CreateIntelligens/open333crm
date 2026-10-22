// @vitest-environment jsdom
/**
 * 序號包匯入欄位（add-coupon-system 12.15）：CSV、Excel 上傳與直接貼上序號。
 */
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { preview } = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('#src/hooks/useCoupons.js', () => ({ previewCodeImport: preview }));

import { availableCodeCount, CodeImportField, EMPTY_IMPORT, type ImportState } from '#src/components/coupons/form/CodeImportField.js';

let latest: ImportState = EMPTY_IMPORT;
function Harness() {
  const [state, setState] = useState<ImportState>(EMPTY_IMPORT);
  latest = state;
  return <CodeImportField id="codes" state={state} onChange={setState} ensureCouponId={async () => 'coupon-1'} />;
}

beforeEach(() => {
  preview.mockReset().mockResolvedValue({ conflicts: [], alreadyImported: [] });
  latest = EMPTY_IMPORT;
});

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

test('直接貼上序號：檢查後顯示成功與錯誤筆數', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '直接貼上序號' }));
  fireEvent.change(screen.getByLabelText('貼上序號'), { target: { value: 'ABCD-1234\nEFGH-5678\nX\nabcd1234' } });
  fireEvent.click(screen.getByRole('button', { name: '檢查序號' }));
  await waitFor(() => assert.equal(latest.status, 'done'));
  assert.deepEqual(latest.codes, ['ABCD-1234', 'EFGH-5678']);
  assert.equal(latest.bad, 1);
  assert.equal(latest.dup, 1);
  assert.equal(latest.fileName, '貼上的序號');
  assert.equal(preview.mock.calls[0][1], 'ABCD-1234\nEFGH-5678');
});

test('沒有貼上內容時不送出', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '直接貼上序號' }));
  fireEvent.click(screen.getByRole('button', { name: '檢查序號' }));
  assert.ok(await screen.findByText('請貼上至少一組序號'));
  assert.equal(preview.mock.calls.length, 0);
});

test('上傳 Excel 檔', async () => {
  const XLSX = await import('@e965/xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['序號'], ['ABCD-1234'], ['EFGH-5678']]), 'S');
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File([buffer], '序號.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  render(<Harness />);
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await waitFor(() => assert.equal(latest.status, 'done'));
  assert.deepEqual(latest.codes, ['ABCD-1234', 'EFGH-5678']);
  assert.equal(latest.fileName, '序號.xlsx');
  assert.ok(fileInput().accept.includes('.xlsx'));
});

test('不支援的檔案格式', async () => {
  render(<Harness />);
  fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'codes.txt', { type: 'text/plain' })] } });
  assert.ok(await screen.findByText('格式不支援，請上傳 .csv 或 .xlsx 檔，或直接貼上序號'));
  assert.equal(preview.mock.calls.length, 0);
});

test('序號包可用數：沒有選檔也沒有既有序號時為「未上傳」', () => {
  assert.equal(availableCodeCount(EMPTY_IMPORT, 0), null);
  assert.equal(availableCodeCount(EMPTY_IMPORT, 3), 3);
});

test('序號包可用數：發布時已寫入後端的序號仍要算進去（發布失敗重試時不被當成未上傳）', () => {
  const done: ImportState = { ...EMPTY_IMPORT, status: 'done', codes: ['A1', 'A2'] };
  assert.equal(availableCodeCount(done, 1), 3);
  assert.equal(availableCodeCount({ ...done, imported: true }, 1), 3);
});
