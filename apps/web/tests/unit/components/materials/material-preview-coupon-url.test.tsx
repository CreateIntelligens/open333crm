// @vitest-environment jsdom
/**
 * 素材預覽把 {{coupon.url}} 顯示成標籤「顧客專屬券連結」（change improve-coupon-url-insert-ux，
 * spec material-system「素材預覽把顧客專屬券連結顯示成標籤」）。編輯框與儲存值不變。
 */
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import { MaterialPreview } from '#src/components/materials/MaterialPreview.js';
import { FbTextEditor } from '#src/components/materials/editors.js';

afterEach(cleanup);

test('預覽顯示標籤（LINE 純文字）', () => {
  const { container } = render(
    <MaterialPreview channelType="line" contentType="line_text" body={{ text: '點這裡領券：{{coupon.url}}' }} />,
  );
  assert.ok(screen.queryByText('顧客專屬券連結') !== null, '應顯示標籤');
  assert.ok(!(container.textContent ?? '').includes('{{coupon.url}}'), '預覽不應出現原字');
  assert.match(container.textContent ?? '', /點這裡領券：/);
});

test('預覽顯示標籤（FB 純文字、FB 按鈕選單）', () => {
  const { container } = render(
    <>
      <MaterialPreview channelType="fb" contentType="fb_text" body={{ text: '{{coupon.url}} 與 {{coupon.url}}' }} />
      <MaterialPreview channelType="fb" contentType="fb_button" body={{ text: '領券 {{coupon.url}}', buttons: [] }} />
    </>,
  );
  assert.equal(screen.queryAllByText('顧客專屬券連結').length, 3);
  assert.ok(!(container.textContent ?? '').includes('{{coupon.url}}'));
});

test('編輯框保留原字', () => {
  let latest: { text?: string } = {};
  function Host() {
    const [body, setBody] = useState<{ text?: string }>({ text: '領券' });
    latest = body;
    return <FbTextEditor body={body} onChange={setBody} />;
  }
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: '插入顧客專屬券連結' }));
  const textarea = screen.getByPlaceholderText('輸入要發送的文字訊息') as HTMLTextAreaElement;
  assert.ok(textarea.value.includes('{{coupon.url}}'));
  assert.ok((latest.text ?? '').includes('{{coupon.url}}'));
});
