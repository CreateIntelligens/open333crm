// @vitest-environment jsdom
/**
 * 文字素材的「插入領券連結」（change improve-coupon-url-insert-ux，spec material-system
 * 「文字素材可插入領券連結」）。列出租戶可用的領券連結，選一條就把公開網址插在游標位置。
 */
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { FbTextEditor, LineTextEditor } from '#src/components/materials/editors.js';

const URL = 'https://crm.example.com/coupon/claim/AB12CD34';
const links = [
  {
    id: 'l1', name: '門市海報', code: 'AB12CD34', url: URL, couponId: 'c1', couponName: '秋季九折',
    channel: { id: 'ch1', channelType: 'LINE', displayName: '本店 LINE', ready: true },
  },
  {
    id: 'l2', name: '粉專置頂', code: 'FB12CD34', url: 'https://crm.example.com/coupon/claim/FB12CD34', couponId: 'c1', couponName: '秋季九折',
    channel: { id: 'ch2', channelType: 'FB', displayName: '本店粉專', ready: true },
  },
];
const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  // 模擬後端依 channelType 篩選
  api.get.mockReset().mockImplementation(async (url: string) => {
    requested.push(url);
    const [path, query] = url.split('?');
    if (path !== '/coupons/claim-links') throw new Error(`unexpected ${url}`);
    const channelType = new URLSearchParams(query ?? '').get('channelType');
    return { data: { success: true, data: links.filter((l) => !channelType || l.channel.channelType === channelType) } };
  });
});
afterEach(cleanup);

type TextEditor = typeof LineTextEditor;
function renderStateful(Editor: TextEditor, initial: string) {
  function Host() {
    const [body, setBody] = useState<{ text?: string }>({ text: initial });
    return <Editor body={body} onChange={setBody} />;
  }
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Host /></SWRConfig>);
  return screen.getByPlaceholderText('輸入要發送的文字訊息') as HTMLTextAreaElement;
}

function openPicker() {
  const button = screen.queryByRole('button', { name: '插入領券連結' });
  assert.ok(button !== null, '應有「插入領券連結」按鈕');
  fireEvent.click(button);
}

test('選一條領券連結插入', async () => {
  const textarea = renderStateful(LineTextEditor, '快來領券');
  textarea.focus();
  textarea.setSelectionRange(2, 2);
  openPicker();

  const option = await screen.findByRole('button', { name: /門市海報/ });
  assert.match(option.textContent ?? '', /秋季九折/);
  assert.match(option.textContent ?? '', /LINE/);
  assert.ok(screen.queryByText(/人人共用/) !== null, '應說明領券連結人人共用');
  fireEvent.click(option);

  assert.equal(textarea.value, `快來${URL}領券`);
  assert.equal(textarea.selectionStart, 2 + URL.length);
  assert.ok(screen.queryByRole('button', { name: /門市海報/ }) === null, '選完後清單關閉');
  assert.deepEqual(requested, ['/coupons/claim-links?channelType=LINE'], 'LINE 素材只查 LINE 的領券連結');
});

test('只列出與素材同渠道的領券連結（FB 素材）', async () => {
  renderStateful(FbTextEditor, '');
  openPicker();
  await screen.findByRole('button', { name: /粉專置頂/ });
  assert.ok(screen.queryByRole('button', { name: /門市海報/ }) === null, '不列 LINE 的連結');
  assert.deepEqual(requested, ['/coupons/claim-links?channelType=FB']);
});

test('沒有可用的領券連結', async () => {
  api.get.mockResolvedValue({ data: { success: true, data: [] } });
  renderStateful(LineTextEditor, '');
  openPicker();
  const empty = await screen.findByText(/還沒有可用的 LINE 領券連結/);
  assert.ok(empty !== null);
  const link = screen.getByRole('link', { name: /優惠券/ });
  assert.equal(link.getAttribute('href'), '/dashboard/marketing/coupons');
});

test('插入領券連結超過字數上限', async () => {
  const textarea = renderStateful(FbTextEditor, 'a'.repeat(1990));
  openPicker();
  fireEvent.click(await screen.findByRole('button', { name: /粉專置頂/ }));
  assert.equal(textarea.value.length, 1990);
  const alert = screen.queryByRole('alert');
  assert.ok(alert !== null, '應顯示超過上限的提示');
  assert.match(alert.textContent ?? '', /2000/);
});

test('清單載入失敗：403 時說明沒有權限', async () => {
  api.get.mockRejectedValue({ response: { status: 403, data: { error: { message: '權限不足' } } } });
  const textarea = renderStateful(LineTextEditor, '快來領券');
  openPicker();
  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent ?? '', /權限/);
  assert.match(alert.textContent ?? '', /檢視優惠券/);
  assert.match(alert.textContent ?? '', /管理行銷/);
  assert.equal(textarea.value, '快來領券');
});
