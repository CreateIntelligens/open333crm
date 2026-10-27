// @vitest-environment jsdom
/**
 * 文字素材的「插入券連結」按鈕（add-material-coupon-url-insert）。
 * 商家不必記 {{coupon.url}}：按鈕插在游標位置，沒點過輸入框時加在結尾；
 * 超過字數上限要擋下並顯示看得到的提示。
 */
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import { FbButtonEditor, FbTextEditor, LineTextEditor } from '#src/components/materials/editors.js';

afterEach(cleanup);

const TOKEN = '{{coupon.url}}';
type TextEditor = typeof LineTextEditor;

/** 受控編輯器需要父層保存 body，才看得到插入後的結果 */
function renderStateful(Editor: TextEditor, initial: string) {
  function Host() {
    const [body, setBody] = useState<{ text?: string }>({ text: initial });
    return <Editor body={body} onChange={setBody} />;
  }
  render(<Host />);
  return screen.getByPlaceholderText('輸入要發送的文字訊息') as HTMLTextAreaElement;
}

function insertButton() {
  const button = screen.queryByRole('button', { name: '插入券連結' });
  assert.ok(button !== null, '畫面上應有「插入券連結」按鈕');
  return button;
}

test('插在游標位置', () => {
  const textarea = renderStateful(LineTextEditor, '快來領券');
  textarea.focus();
  textarea.setSelectionRange(2, 2);
  fireEvent.click(insertButton());

  assert.equal(textarea.value, `快來${TOKEN}領券`);
  assert.ok(document.activeElement === textarea, '插入後焦點應留在輸入框');
  assert.equal(textarea.selectionStart, 2 + TOKEN.length);
  assert.equal(textarea.selectionEnd, 2 + TOKEN.length);
});

test('取代選取文字', () => {
  const textarea = renderStateful(FbTextEditor, '請點這裡領券');
  textarea.focus();
  textarea.setSelectionRange(2, 4);
  fireEvent.click(insertButton());

  assert.equal(textarea.value, `請點${TOKEN}領券`);
});

test('沒有游標時加在結尾', () => {
  const textarea = renderStateful(LineTextEditor, '快來領券');
  // 從未取得焦點：瀏覽器預設游標可能在開頭，不能插在那裡
  textarea.setSelectionRange(0, 0);
  fireEvent.click(insertButton());

  assert.equal(textarea.value, `快來領券${TOKEN}`);
  assert.ok(document.activeElement === textarea, '插入後焦點應留在輸入框');
  assert.equal(textarea.selectionStart, textarea.value.length);
});

test('其他版型沒有插入按鈕', () => {
  render(<FbButtonEditor body={{ text: '選一個', buttons: [] }} onChange={vi.fn()} />);
  assert.ok(screen.queryByRole('button', { name: '插入券連結' }) === null);
});

test('顯示說明文字（LINE 純文字）', () => {
  renderStateful(LineTextEditor, '');
  const hint = screen.queryByText(/附券廣播/);
  assert.ok(hint !== null, '應顯示附券廣播的說明');
  assert.match(hint.textContent ?? '', /建立廣播時選擇/);
  assert.match(hint.textContent ?? '', /不會替換/);
});

test('顯示說明文字（FB 純文字）', () => {
  renderStateful(FbTextEditor, '');
  const hint = screen.queryByText(/附券廣播/);
  assert.ok(hint !== null, '應顯示附券廣播的說明');
  assert.match(hint.textContent ?? '', /建立廣播時選擇/);
  assert.match(hint.textContent ?? '', /不會替換/);
});

test('超過上限時擋下並提示', () => {
  const textarea = renderStateful(LineTextEditor, 'a'.repeat(4990));
  fireEvent.click(insertButton());

  assert.equal(textarea.value.length, 4990);
  const alert = screen.queryByRole('alert');
  assert.ok(alert !== null, '應顯示超過上限的提示');
  assert.match(alert.textContent ?? '', /5000/);
});

test('剛好等於上限時允許插入', () => {
  const textarea = renderStateful(FbTextEditor, 'a'.repeat(2000 - TOKEN.length));
  fireEvent.click(insertButton());

  assert.equal(textarea.value.length, 2000);
  assert.ok(textarea.value.endsWith(TOKEN));
  assert.ok(screen.queryByRole('alert') === null);
});

test('內容變動後提示消失', () => {
  const textarea = renderStateful(LineTextEditor, 'a'.repeat(4990));
  fireEvent.click(insertButton());
  assert.ok(screen.queryByRole('alert') !== null, '應先出現超過上限的提示');

  fireEvent.change(textarea, { target: { value: 'a'.repeat(4900) } });
  assert.ok(screen.queryByRole('alert') === null);
});
